"""Blob uploads (spec 5a 6.5, P-061, P-065): checked, verified, deduplicated, owned per user."""

import hashlib
from xml.etree.ElementTree import ParseError

from defusedxml import DefusedXmlException
from defusedxml import ElementTree as SafeXml
from fastapi import Request
from sqlalchemy import select
from sqlalchemy.dialects.mysql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import Blob, User, UserBlob
from app.errors import ApiError
from app.storage.blobs import BlobStore

MAX_BLOB_BYTES = 5 * 1024 * 1024
MARKDOWN = "text/markdown"
ALLOWED_TYPES = frozenset(
    {MARKDOWN, "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"}
)
SVG_ROOTS = frozenset({"svg", "{http://www.w3.org/2000/svg}svg"})


def media_type(header: str | None) -> str:
    """`text/markdown; charset=utf-8` → `text/markdown`."""
    return (header or "").split(";", 1)[0].strip().lower()


def _unsupported(message: str) -> ApiError:
    return ApiError(415, "unsupported_type", message)


def _too_large() -> ApiError:
    return ApiError(413, "too_large", "Blobs are limited to 5 MB.")


def check_type(content_type: str) -> None:
    if content_type not in ALLOWED_TYPES:
        raise _unsupported("Only Markdown and PNG, JPEG, GIF, WebP or SVG images are accepted.")


def _is_svg(data: bytes) -> bool:
    try:
        root = SafeXml.fromstring(data, forbid_dtd=True)
    except ParseError, DefusedXmlException, ValueError:
        return False
    return root.tag in SVG_ROOTS


def _matches(content_type: str, data: bytes) -> bool:
    match content_type:
        case "text/markdown":
            try:
                data.decode("utf-8")
            except UnicodeDecodeError:
                return False
            return True
        case "image/png":
            return data.startswith(b"\x89PNG\r\n\x1a\n")
        case "image/jpeg":
            return data.startswith(b"\xff\xd8\xff")
        case "image/gif":
            return data.startswith((b"GIF87a", b"GIF89a"))
        case "image/webp":
            return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
        case "image/svg+xml":
            return _is_svg(data)
    return False


def check_content(content_type: str, data: bytes) -> None:
    """The bytes must be what the type says, so a blob can't pose as another kind of file."""
    check_type(content_type)
    if not _matches(content_type, data):
        raise _unsupported(f"The content is not valid {content_type}.")


async def read_limited(request: Request, limit: int = MAX_BLOB_BYTES) -> bytes:
    """The request body, refusing more than `limit` bytes without reading them all."""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > limit:
        raise _too_large()
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise _too_large()
        chunks.append(chunk)
    return b"".join(chunks)


def owned_blob(db: Session, user: User, hash: str) -> Blob | None:
    return db.scalars(
        select(Blob)
        .join(UserBlob, UserBlob.hash == Blob.hash)
        .where(UserBlob.user_id == user.id, Blob.hash == hash)
    ).one_or_none()


def _owns(db: Session, user: User, hash: str) -> bool:
    return (
        db.scalar(select(UserBlob.hash).where(UserBlob.user_id == user.id, UserBlob.hash == hash))
        is not None
    )


def _insert_owner(db: Session, user: User, hash: str) -> None:
    statement = insert(UserBlob).values(user_id=user.id, hash=hash)
    db.execute(statement.on_duplicate_key_update(user_id=statement.inserted.user_id))


def _store_once(
    db: Session, store: BlobStore, user: User, hash: str, content_type: str, data: bytes
) -> bool:
    if db.scalar(select(Blob.hash).where(Blob.hash == hash)) is None:
        # Bytes before the row, so a row never points at a missing object (spec 7.1).
        store.put(hash, data, content_type)
        statement = insert(Blob).values(hash=hash, size=len(data), content_type=content_type)
        db.execute(statement.on_duplicate_key_update(hash=statement.inserted.hash))
    new = not _owns(db, user, hash)
    if new:
        _insert_owner(db, user, hash)
    db.commit()
    return new


def store_blob(
    db: Session, store: BlobStore, user: User, hash: str, content_type: str, data: bytes
) -> bool:
    """Verify and store the bytes for `user`; True when the user didn't own them before."""
    if hashlib.sha256(data).hexdigest() != hash:
        raise ApiError(422, "hash_mismatch", "The content doesn't match its hash.")
    check_content(content_type, data)
    try:
        return _store_once(db, store, user, hash, content_type, data)
    except IntegrityError:
        # An account-delete sweep removed the blob row meanwhile (spec 7.4); store it afresh.
        db.rollback()
        return _store_once(db, store, user, hash, content_type, data)

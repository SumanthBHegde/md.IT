"""Linear per-document versions (spec 5a 6.4, P-062).

A save locks the document row, then reads the latest version with a locking read: a plain
read would use the REPEATABLE READ snapshot that the session lookup already fixed, and miss
a version committed while this save waited for the lock (planning probe, P-068).
"""

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, aliased

from app.db.models import Blob, Document, Project, User, UserBlob, Version, VersionImage
from app.errors import ApiError
from app.schemas.versions import ImageRef, VersionDetail, VersionIn, VersionSummary
from app.services.blobs import MARKDOWN
from app.services.projects import get_document, latest_out, not_found


def latest_version(db: Session, document: Document, *, lock: bool = False) -> Version | None:
    query = (
        select(Version)
        .where(Version.document_id == document.id)
        .order_by(Version.number.desc())
        .limit(1)
    )
    if lock:
        query = query.with_for_update()
    return db.scalars(query).one_or_none()


def _summary(version: Version, parent_id: str | None) -> VersionSummary:
    return VersionSummary(
        id=version.public_id,
        number=version.number,
        message=version.message,
        parent_id=parent_id,
        created_at=version.created_at,
    )


def _detail(
    version: Version, parent_id: str | None, document: Document, images: list[ImageRef]
) -> VersionDetail:
    return VersionDetail(
        **_summary(version, parent_id).model_dump(),
        document_id=document.public_id,
        content_hash=version.content_hash,
        images=images,
    )


def _conflict(latest: Version | None) -> ApiError:
    out = latest_out(latest)
    return ApiError(
        409,
        "version_conflict",
        "A newer version was saved. Load it or save yours as a copy.",
        {"latest": out.model_dump(mode="json") if out else None},
    )


def save_version(db: Session, user: User, document_id: str, body: VersionIn) -> VersionDetail:
    document = get_document(db, user, document_id, for_update=True)
    latest = latest_version(db, document, lock=True)
    if body.parent_version_id != (latest.public_id if latest else None):
        raise _conflict(latest)

    hashes = {body.content_hash, *(image.hash for image in body.images)}
    owned = set(
        db.scalars(
            select(UserBlob.hash).where(UserBlob.user_id == user.id, UserBlob.hash.in_(hashes))
        )
    )
    missing = sorted(hashes - owned)
    if missing:
        raise ApiError(422, "blob_missing", "Upload these blobs first.", {"missing": missing})
    content_type = db.scalar(select(Blob.content_type).where(Blob.hash == body.content_hash))
    if content_type != MARKDOWN:
        raise ApiError(
            422,
            "blob_missing",
            "The content must be a Markdown blob.",
            {"missing": [body.content_hash]},
        )

    version = Version(
        document_id=document.id,
        parent_version_id=latest.id if latest else None,
        number=document.next_number,
        content_hash=body.content_hash,
        message=body.message,
    )
    document.next_number += 1
    document.path = body.path
    db.add(version)
    db.flush()
    db.add_all(
        VersionImage(version_id=version.id, path=image.path, hash=image.hash)
        for image in body.images
    )
    db.commit()
    return _detail(version, latest.public_id if latest else None, document, body.images)


def list_versions(db: Session, user: User, document_id: str) -> list[VersionSummary]:
    document = get_document(db, user, document_id)
    parent = aliased(Version)
    rows = db.execute(
        select(Version, parent.public_id)
        .outerjoin(parent, parent.id == Version.parent_version_id)
        .where(Version.document_id == document.id)
        .order_by(Version.number.desc())
    ).all()
    return [_summary(version, parent_id) for version, parent_id in rows]


def _get(db: Session, user: User, version_id: str) -> tuple[Version, Document]:
    row = db.execute(
        select(Version, Document)
        .join(Document, Document.id == Version.document_id)
        .join(Project, Project.id == Document.project_id)
        .where(Version.public_id == version_id, Project.user_id == user.id)
    ).one_or_none()
    if row is None:
        raise not_found()
    return row[0], row[1]


def get_version(db: Session, user: User, version_id: str) -> VersionDetail:
    version, document = _get(db, user, version_id)
    parent_id = (
        db.scalar(select(Version.public_id).where(Version.id == version.parent_version_id))
        if version.parent_version_id is not None
        else None
    )
    images = [
        ImageRef(path=image.path, hash=image.hash)
        for image in db.scalars(
            select(VersionImage)
            .where(VersionImage.version_id == version.id)
            .order_by(VersionImage.id)
        )
    ]
    return _detail(version, parent_id, document, images)


def delete_version(db: Session, user: User, version_id: str) -> None:
    """Children keep their history with a null parent; blobs stay owned (P-049, P-061)."""
    version, _ = _get(db, user, version_id)
    db.execute(delete(Version).where(Version.id == version.id))
    db.commit()

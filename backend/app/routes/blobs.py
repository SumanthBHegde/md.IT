"""Content-addressed blobs: version text and images (spec 5a 6.5).

A user sees only blobs they uploaded (P-061). Downloads are sandboxed attachments (P-065).
"""

import logging

from fastapi import APIRouter, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from app.auth import CurrentUser
from app.db.session import DbSession
from app.errors import ApiError
from app.schemas.blobs import BlobOut
from app.schemas.common import error_responses
from app.services.blobs import (
    ALLOWED_TYPES,
    check_type,
    media_type,
    owned_blob,
    read_limited,
    store_blob,
)
from app.storage.blobs import BlobStore, is_blob_hash

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/blobs", tags=["blobs"])

DOWNLOAD_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Content-Disposition": "attachment",
    "Cache-Control": "private, max-age=31536000, immutable",
}
UPLOAD_BODY = {
    "requestBody": {
        "required": True,
        "content": {
            content_type: {"schema": {"type": "string", "format": "binary"}}
            for content_type in sorted(ALLOWED_TYPES)
        },
    }
}


def _not_found() -> ApiError:
    return ApiError(404, "not_found", "Not found.")


def _checked(hash: str) -> str:
    if not is_blob_hash(hash):
        raise _not_found()
    return hash


def _store(request: Request) -> BlobStore:
    store: BlobStore = request.app.state.blobs
    return store


@router.head(
    "/{hash}",
    operation_id="blobExists",
    status_code=200,
    response_class=Response,
    responses=error_responses(401, 404),
)
def blob_exists(hash: str, user: CurrentUser, db: DbSession) -> Response:
    if owned_blob(db, user, _checked(hash)) is None:
        raise _not_found()
    return Response(status_code=200)


@router.put(
    "/{hash}",
    operation_id="uploadBlob",
    status_code=201,
    response_model=BlobOut,
    responses={
        200: {"model": BlobOut, "description": "Already stored for this user"},
        **error_responses(401, 403, 404, 413, 415, 422),
    },
    openapi_extra=UPLOAD_BODY,
)
async def upload_blob(hash: str, request: Request, user: CurrentUser, db: DbSession) -> Response:
    _checked(hash)
    content_type = media_type(request.headers.get("content-type"))
    check_type(content_type)  # before reading the body
    data = await read_limited(request)
    created = await run_in_threadpool(
        store_blob, db, _store(request), user, hash, content_type, data
    )
    body = BlobOut(hash=hash, size=len(data), content_type=content_type)
    return JSONResponse(body.model_dump(), status_code=201 if created else 200)


@router.get(
    "/{hash}",
    operation_id="getBlob",
    response_class=Response,
    responses={
        200: {"description": "The bytes, as a sandboxed attachment"},
        **error_responses(401, 404),
    },
)
def get_blob(hash: str, request: Request, user: CurrentUser, db: DbSession) -> Response:
    owned = owned_blob(db, user, _checked(hash))
    if owned is None:
        raise _not_found()
    data = _store(request).get(owned.hash)
    if data is None:
        log.error("Blob %s has a row but no stored object", owned.hash)
        raise ApiError(500, "internal_error", "Something went wrong.")
    # The type this user stored it as, not the first uploader's (P-074).
    return Response(data, media_type=owned.content_type, headers=DOWNLOAD_HEADERS)

"""Versions (spec 5a 6.4): explicit saves with a parent; 409 when another device saved first."""

from fastapi import APIRouter, Response

from app.auth import CurrentUser
from app.db.session import DbSession
from app.schemas.common import error_responses
from app.schemas.versions import VersionDetail, VersionIn, VersionSummary
from app.services import versions as service

router = APIRouter(tags=["versions"])


@router.get(
    "/api/documents/{document_id}/versions",
    operation_id="listVersions",
    response_model=list[VersionSummary],
    responses=error_responses(401, 404),
)
def list_versions(document_id: str, user: CurrentUser, db: DbSession) -> list[VersionSummary]:
    return service.list_versions(db, user, document_id)


@router.post(
    "/api/documents/{document_id}/versions",
    operation_id="saveVersion",
    status_code=201,
    response_model=VersionDetail,
    responses=error_responses(401, 403, 404, 409, 422),
)
def save_version(
    document_id: str, body: VersionIn, user: CurrentUser, db: DbSession
) -> VersionDetail:
    return service.save_version(db, user, document_id, body)


@router.get(
    "/api/versions/{version_id}",
    operation_id="getVersion",
    response_model=VersionDetail,
    responses=error_responses(401, 404),
)
def get_version(version_id: str, user: CurrentUser, db: DbSession) -> VersionDetail:
    return service.get_version(db, user, version_id)


@router.delete(
    "/api/versions/{version_id}",
    operation_id="deleteVersion",
    status_code=204,
    responses=error_responses(401, 403, 404),
)
def delete_version(version_id: str, user: CurrentUser, db: DbSession) -> Response:
    service.delete_version(db, user, version_id)
    return Response(status_code=204)

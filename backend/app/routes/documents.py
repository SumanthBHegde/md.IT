"""Cloud documents (spec 5a 6.3): identities and paths; content lives in versions."""

from fastapi import APIRouter, Response

from app.auth import CurrentUser
from app.db.session import DbSession
from app.schemas.common import error_responses
from app.schemas.documents import DocumentIn, DocumentOut
from app.services import projects as service

router = APIRouter(tags=["documents"])


@router.get(
    "/api/projects/{project_id}/documents",
    operation_id="listDocuments",
    response_model=list[DocumentOut],
    responses=error_responses(401, 404),
)
def list_documents(project_id: str, user: CurrentUser, db: DbSession) -> list[DocumentOut]:
    return service.list_documents(db, user, project_id)


@router.post(
    "/api/projects/{project_id}/documents",
    operation_id="createDocument",
    status_code=201,
    response_model=DocumentOut,
    responses=error_responses(401, 403, 404, 422),
)
def create_document(
    project_id: str, body: DocumentIn, user: CurrentUser, db: DbSession
) -> DocumentOut:
    return service.create_document(db, user, project_id, body.path)


@router.delete(
    "/api/documents/{document_id}",
    operation_id="deleteDocument",
    status_code=204,
    responses=error_responses(401, 403, 404),
)
def delete_document(document_id: str, user: CurrentUser, db: DbSession) -> Response:
    service.delete_document(db, user, document_id)
    return Response(status_code=204)

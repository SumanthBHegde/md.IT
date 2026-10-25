"""Cloud projects (spec 5a 6.2). A local project links to one on its first saved version."""

from fastapi import APIRouter, Response

from app.auth import CurrentUser
from app.db.session import DbSession
from app.schemas.common import error_responses
from app.schemas.projects import ProjectIn, ProjectOut
from app.services import projects as service

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get(
    "",
    operation_id="listProjects",
    response_model=list[ProjectOut],
    responses=error_responses(401),
)
def list_projects(user: CurrentUser, db: DbSession) -> list[ProjectOut]:
    return service.list_projects(db, user)


@router.post(
    "",
    operation_id="createProject",
    status_code=201,
    response_model=ProjectOut,
    responses=error_responses(401, 403, 422),
)
def create_project(body: ProjectIn, user: CurrentUser, db: DbSession) -> ProjectOut:
    return service.create_project(db, user, body.name)


@router.patch(
    "/{project_id}",
    operation_id="renameProject",
    response_model=ProjectOut,
    responses=error_responses(401, 403, 404, 422),
)
def rename_project(
    project_id: str, body: ProjectIn, user: CurrentUser, db: DbSession
) -> ProjectOut:
    return service.rename_project(db, user, project_id, body.name)


@router.delete(
    "/{project_id}",
    operation_id="deleteProject",
    status_code=204,
    responses=error_responses(401, 403, 404),
)
def delete_project(project_id: str, user: CurrentUser, db: DbSession) -> Response:
    service.delete_project(db, user, project_id)
    return Response(status_code=204)

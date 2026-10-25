"""Projects and documents, always looked up through the signed-in user (spec 5a 6.1–6.3)."""

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models import Document, Project, User, Version
from app.errors import ApiError
from app.schemas.documents import DocumentOut, LatestOut
from app.schemas.projects import ProjectOut


def not_found() -> ApiError:
    """Missing and someone else's look the same, so existence never leaks."""
    return ApiError(404, "not_found", "Not found.")


def get_project(db: Session, user: User, project_id: str) -> Project:
    project = db.scalars(
        select(Project).where(Project.public_id == project_id, Project.user_id == user.id)
    ).one_or_none()
    if project is None:
        raise not_found()
    return project


def get_document(
    db: Session, user: User, document_id: str, *, for_update: bool = False
) -> Document:
    query = (
        select(Document)
        .join(Project, Project.id == Document.project_id)
        .where(Document.public_id == document_id, Project.user_id == user.id)
    )
    if for_update:
        query = query.with_for_update(of=Document)
    document = db.scalars(query).one_or_none()
    if document is None:
        raise not_found()
    return document


def latest_out(version: Version | None) -> LatestOut | None:
    if version is None:
        return None
    return LatestOut(id=version.public_id, number=version.number, created_at=version.created_at)


def _project_out(project: Project, document_count: int) -> ProjectOut:
    return ProjectOut(
        id=project.public_id,
        name=project.name,
        created_at=project.created_at,
        document_count=document_count,
    )


def list_projects(db: Session, user: User) -> list[ProjectOut]:
    counts = (
        select(Document.project_id, func.count().label("n"))
        .group_by(Document.project_id)
        .subquery()
    )
    rows = db.execute(
        select(Project, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.project_id == Project.id)
        .where(Project.user_id == user.id)
        .order_by(Project.created_at.desc(), Project.id.desc())
    ).all()
    return [_project_out(project, count) for project, count in rows]


def create_project(db: Session, user: User, name: str) -> ProjectOut:
    project = Project(user_id=user.id, name=name)
    db.add(project)
    db.commit()
    return _project_out(project, 0)


def rename_project(db: Session, user: User, project_id: str, name: str) -> ProjectOut:
    project = get_project(db, user, project_id)
    project.name = name
    db.commit()
    count = db.scalar(select(func.count()).where(Document.project_id == project.id)) or 0
    return _project_out(project, count)


def delete_project(db: Session, user: User, project_id: str) -> None:
    """Cascades to documents, versions and version images; blobs stay owned (P-061)."""
    project = get_project(db, user, project_id)
    db.execute(delete(Project).where(Project.id == project.id))
    db.commit()


def _latest_by_document(db: Session, document_ids: list[int]) -> dict[int, Version]:
    if not document_ids:
        return {}
    highest = (
        select(Version.document_id, func.max(Version.number).label("number"))
        .where(Version.document_id.in_(document_ids))
        .group_by(Version.document_id)
        .subquery()
    )
    versions = db.scalars(
        select(Version).join(
            highest,
            (highest.c.document_id == Version.document_id) & (highest.c.number == Version.number),
        )
    )
    return {version.document_id: version for version in versions}


def _document_out(document: Document, latest: Version | None) -> DocumentOut:
    return DocumentOut(
        id=document.public_id,
        path=document.path,
        created_at=document.created_at,
        latest=latest_out(latest),
    )


def list_documents(db: Session, user: User, project_id: str) -> list[DocumentOut]:
    project = get_project(db, user, project_id)
    documents = list(
        db.scalars(
            select(Document)
            .where(Document.project_id == project.id)
            .order_by(Document.path, Document.id)
        )
    )
    latest = _latest_by_document(db, [document.id for document in documents])
    return [_document_out(document, latest.get(document.id)) for document in documents]


def create_document(db: Session, user: User, project_id: str, path: str) -> DocumentOut:
    project = get_project(db, user, project_id)
    document = Document(project_id=project.id, path=path)
    db.add(document)
    db.commit()
    return _document_out(document, None)


def delete_document(db: Session, user: User, document_id: str) -> None:
    """Cascades to its versions and their image lists."""
    document = get_document(db, user, document_id)
    db.execute(delete(Document).where(Document.id == document.id))
    db.commit()

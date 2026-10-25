from typing import Annotated

from pydantic import BaseModel, StringConstraints

from app.schemas.common import UtcDateTime

ProjectName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]


class ProjectIn(BaseModel):
    name: ProjectName


class ProjectOut(BaseModel):
    id: str
    name: str
    created_at: UtcDateTime
    document_count: int

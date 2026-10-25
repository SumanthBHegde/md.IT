from pydantic import BaseModel

from app.schemas.common import UtcDateTime
from app.schemas.paths import DocumentPath


class LatestOut(BaseModel):
    id: str
    number: int
    created_at: UtcDateTime


class DocumentIn(BaseModel):
    path: DocumentPath


class DocumentOut(BaseModel):
    id: str
    path: str
    created_at: UtcDateTime
    latest: LatestOut | None

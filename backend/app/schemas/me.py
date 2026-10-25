from pydantic import BaseModel

from app.schemas.common import UtcDateTime


class MeOut(BaseModel):
    id: str
    provider: str
    email: str | None
    created_at: UtcDateTime

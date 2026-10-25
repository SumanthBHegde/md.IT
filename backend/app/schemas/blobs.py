from pydantic import BaseModel


class BlobOut(BaseModel):
    hash: str
    size: int
    content_type: str

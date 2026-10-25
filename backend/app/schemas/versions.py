from typing import Annotated, Self

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

from app.schemas.common import UtcDateTime
from app.schemas.paths import DocumentPath, ImagePath

BlobHash = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
MAX_IMAGES = 500


class ImageRef(BaseModel):
    path: ImagePath
    hash: BlobHash


class VersionIn(BaseModel):
    # Required, though it may be null: the client states which version it built on.
    parent_version_id: str | None
    content_hash: BlobHash
    message: Annotated[str | None, StringConstraints(max_length=500)] = None
    path: DocumentPath
    images: Annotated[list[ImageRef], Field(max_length=MAX_IMAGES)] = []

    @field_validator("message")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        return value if value and value.strip() else None

    @model_validator(mode="after")
    def _unique_image_paths(self) -> Self:
        # Case-insensitive, like sibling names in the local store (P-008).
        paths = [image.path.casefold() for image in self.images]
        if len(paths) != len(set(paths)):
            raise ValueError("Each image path may appear only once.")
        return self


class VersionSummary(BaseModel):
    id: str
    number: int
    message: str | None
    parent_id: str | None
    created_at: UtcDateTime


class VersionDetail(VersionSummary):
    document_id: str
    content_hash: str
    images: list[ImageRef]

"""Types and error models shared by every API schema (P-052, P-063)."""

from datetime import UTC, datetime
from typing import Annotated, Any

from pydantic import BaseModel, PlainSerializer


def _utc_iso(value: datetime) -> str:
    if value.tzinfo is None:  # MySQL hands back naive UTC (P-049)
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


UtcDateTime = Annotated[datetime, PlainSerializer(_utc_iso, return_type=str)]


class ErrorBody(BaseModel):
    code: str
    message: str
    details: Any = None


class ErrorOut(BaseModel):
    error: ErrorBody


def error_responses(*statuses: int) -> dict[int | str, dict[str, Any]]:
    """OpenAPI `responses=` entries in the standard error shape."""
    return {status: {"model": ErrorOut} for status in statuses}

"""Project-relative paths for documents and version images (spec 5a 6.3)."""

from typing import Annotated

from pydantic import AfterValidator

MAX_PATH = 1024


def check_path(value: str, *, markdown: bool) -> str:
    """`notes/Plan.md`: `/`-separated, no empty, `.` or `..` segments, no `\\` or control
    characters, at most 1024 characters; documents end in `.md`."""
    if not 1 <= len(value) <= MAX_PATH:
        raise ValueError(f"A path must be 1 to {MAX_PATH} characters.")
    if "\\" in value or any(ord(c) < 0x20 or ord(c) == 0x7F for c in value):
        raise ValueError("A path can't contain backslashes or control characters.")
    if any(segment in ("", ".", "..") for segment in value.split("/")):
        raise ValueError("A path is names separated by single slashes, without . or ..")
    if markdown and not value.lower().endswith(".md"):
        raise ValueError("A document path must end in .md.")
    return value


def _document(value: str) -> str:
    return check_path(value, markdown=True)


def _image(value: str) -> str:
    return check_path(value, markdown=False)


DocumentPath = Annotated[str, AfterValidator(_document)]
ImagePath = Annotated[str, AfterValidator(_image)]

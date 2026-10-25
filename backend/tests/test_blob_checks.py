"""Upload content checks: the bytes must be what the Content-Type says (spec 5a 6.5)."""

import pytest

from app.errors import ApiError
from app.services.blobs import ALLOWED_TYPES, check_content, media_type

PNG = b"\x89PNG\r\n\x1a\n" + bytes(16)
JPEG = b"\xff\xd8\xff\xe0" + bytes(16)
GIF = b"GIF89a" + bytes(16)
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + bytes(8)
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect/></svg>'
MD = "# Notes\n\nÜnïcödé ✓\n".encode()


def test_allowed_types() -> None:
    assert (
        frozenset(
            {"text/markdown", "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"}
        )
        == ALLOWED_TYPES
    )


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("text/markdown", "text/markdown"),
        ("text/markdown; charset=utf-8", "text/markdown"),
        ("Image/PNG", "image/png"),
        (None, ""),
    ],
)
def test_media_type(header: str | None, expected: str) -> None:
    assert media_type(header) == expected


@pytest.mark.parametrize(
    ("ctype", "body"),
    [
        ("image/png", PNG),
        ("image/jpeg", JPEG),
        ("image/gif", GIF),
        ("image/gif", b"GIF87a" + bytes(4)),
        ("image/webp", WEBP),
        ("image/svg+xml", SVG),
        ("image/svg+xml", b"<?xml version='1.0'?><svg/>"),
        ("text/markdown", MD),
        ("text/markdown", b""),
    ],
)
def test_matching_content_accepted(ctype: str, body: bytes) -> None:
    check_content(ctype, body)


@pytest.mark.parametrize(
    ("ctype", "body"),
    [
        ("image/png", GIF),
        ("image/jpeg", PNG),
        ("image/gif", JPEG),
        ("image/webp", b"RIFF\x00\x00\x00\x00WAVEfmt "),
        ("text/markdown", b"\xff\xfe\x00"),
        ("image/svg+xml", b"<html><body/></html>"),
        ("image/svg+xml", b"not xml at all"),
        (
            "image/svg+xml",
            b'<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
        ),
        ("application/pdf", b"%PDF-1.7"),
    ],
)
def test_content_must_match_type(ctype: str, body: bytes) -> None:
    with pytest.raises(ApiError) as info:
        check_content(ctype, body)
    assert (info.value.status, info.value.code) == (415, "unsupported_type")

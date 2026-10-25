"""The project-relative path rule for documents and version images (spec 5a 6.3)."""

import pytest

from app.schemas.paths import check_path


@pytest.mark.parametrize(
    "ok", ["a.md", "notes/Plan.MD", "日本/メモ.md", "a b/c.md", "x" * 1021 + ".md", ".hidden.md"]
)
def test_document_paths_accepted(ok: str) -> None:
    assert check_path(ok, markdown=True) == ok


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "/a.md",
        "a.md/",
        "a//b.md",
        "./a.md",
        "a/../b.md",
        "..",
        "a\\b.md",
        "a\x00.md",
        "a\n.md",
        "a\x7f.md",
        "a.txt",
        "a.md.txt",
        "x" * 1022 + ".md",
    ],
)
def test_document_paths_rejected(bad: str) -> None:
    with pytest.raises(ValueError):
        check_path(bad, markdown=True)


def test_image_path_needs_no_md_suffix() -> None:
    assert check_path("images/diagram.png", markdown=False) == "images/diagram.png"


def test_image_path_follows_the_same_rule() -> None:
    with pytest.raises(ValueError):
        check_path("../secret.png", markdown=False)

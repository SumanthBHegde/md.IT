"""Per-document linear versions with conflict detection (spec 5a 6.4, P-062)."""

import hashlib
import threading
from dataclasses import dataclass
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from app.db.models import Document, User, Version
from app.errors import ApiError
from app.schemas.versions import VersionIn
from app.services.versions import save_version
from tests.support import sign_in

pytestmark = pytest.mark.integration

PNG = b"\x89PNG\r\n\x1a\n" + bytes(16)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def upload(client: TestClient, data: bytes, ctype: str = "text/markdown") -> str:
    response = client.put(f"/api/blobs/{sha(data)}", content=data, headers={"Content-Type": ctype})
    assert response.status_code in (200, 201), response.text
    return sha(data)


@dataclass
class Doc:
    id: str
    project_id: str
    user: User


def make_doc(client: TestClient, engine: Engine, name: str = "alice") -> Doc:
    user = sign_in(client, engine, name)
    project_id = client.post("/api/projects", json={"name": "Notes"}).json()["id"]
    doc = client.post(f"/api/projects/{project_id}/documents", json={"path": "Notes.md"}).json()
    return Doc(doc["id"], project_id, user)


def save(
    client: TestClient, doc: Doc, parent: str | None, content: bytes = b"# v\n", **body: Any
) -> httpx2.Response:
    payload = {
        "parent_version_id": parent,
        "content_hash": upload(client, content),
        "path": "Notes.md",
        **body,
    }
    return client.post(f"/api/documents/{doc.id}/versions", json=payload)


def saved(client: TestClient, doc: Doc, parent: str | None, content: bytes = b"# v\n") -> str:
    response = save(client, doc, parent, content)
    assert response.status_code == 201, response.text
    version_id: str = response.json()["id"]
    return version_id


def test_first_save_is_version_1(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    image = upload(client, PNG, "image/png")
    response = save(
        client,
        doc,
        None,
        message="First draft",
        images=[{"path": "images/dot.png", "hash": image}],
    )
    assert response.status_code == 201
    body = response.json()
    assert (body["number"], body["parent_id"], body["message"]) == (1, None, "First draft")
    assert body["document_id"] == doc.id
    assert body["content_hash"] == sha(b"# v\n")
    assert body["images"] == [{"path": "images/dot.png", "hash": image}]


def test_first_save_with_a_parent_is_409(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    response = save(client, doc, "6a1e4f0e-0000-4000-8000-000000000000")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "version_conflict"
    assert response.json()["error"]["details"] == {"latest": None}


def test_save_on_latest_increments(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    v1 = saved(client, doc, None)
    body = save(client, doc, v1, b"# v2\n").json()
    assert (body["number"], body["parent_id"]) == (2, v1)


def test_stale_parent_is_409_with_latest(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    v1 = saved(client, doc, None)
    v2 = saved(client, doc, v1, b"# v2\n")
    response = save(client, doc, v1, b"# mine\n")
    assert response.status_code == 409
    latest = response.json()["error"]["details"]["latest"]
    assert (latest["id"], latest["number"]) == (v2, 2)
    assert latest["created_at"].endswith("Z")


def body_for(content_hash: str, parent: str | None) -> VersionIn:
    return VersionIn(parent_version_id=parent, content_hash=content_hash, path="Notes.md")


def test_save_sees_a_version_committed_after_its_snapshot(
    client: TestClient, clean_db: Engine
) -> None:
    # The planning probe's REPEATABLE READ trap: B's transaction already read something (as
    # the session lookup does) before A commits v2. B's save on v1 must still see v2 → 409.
    doc = make_doc(client, clean_db)
    v1 = saved(client, doc, None)
    content = upload(client, b"# v2\n")
    with Session(clean_db) as b_db:
        b_user = b_db.get(User, doc.user.id)  # fixes B's snapshot
        assert b_user is not None
        b_db.scalars(select(Version)).all()
        with Session(clean_db) as a_db:
            a_user = a_db.get(User, doc.user.id)
            assert a_user is not None
            save_version(a_db, a_user, doc.id, body_for(content, v1))
        with pytest.raises(ApiError) as info:
            save_version(b_db, b_user, doc.id, body_for(content, v1))
        assert info.value.status == 409
    with Session(clean_db) as db:
        document = db.scalars(select(Document).where(Document.public_id == doc.id)).one()
        assert document.next_number == 3
        assert [v.number for v in db.scalars(select(Version).order_by(Version.number))] == [1, 2]


def test_concurrent_saves_one_wins(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    v1 = saved(client, doc, None)
    content = upload(client, b"# race\n")
    barrier = threading.Barrier(2)
    outcomes: list[int] = []

    def attempt() -> None:
        with Session(clean_db) as db:
            user = db.get(User, doc.user.id)
            assert user is not None
            barrier.wait()
            try:
                save_version(db, user, doc.id, body_for(content, v1))
                outcomes.append(201)
            except ApiError as error:
                outcomes.append(error.status)

    threads = [threading.Thread(target=attempt) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert sorted(outcomes) == [201, 409]


def test_numbers_are_not_reused_after_delete(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    v1 = saved(client, doc, None)
    v2 = saved(client, doc, v1, b"# v2\n")
    assert client.delete(f"/api/versions/{v2}").status_code == 204
    assert save(client, doc, v1, b"# v3\n").json()["number"] == 3


def test_deleting_latest_makes_previous_latest(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    v1 = saved(client, doc, None)
    v2 = saved(client, doc, v1, b"# v2\n")
    client.delete(f"/api/versions/{v2}")
    listed = client.get(f"/api/projects/{doc.project_id}/documents").json()
    assert (listed[0]["latest"]["id"], listed[0]["latest"]["number"]) == (v1, 1)
    assert save(client, doc, v2, b"# stale\n").status_code == 409


def test_deleting_parent_nulls_child_parent(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    v1 = saved(client, doc, None)
    v2 = saved(client, doc, v1, b"# v2\n")
    client.delete(f"/api/versions/{v1}")
    assert client.get(f"/api/versions/{v2}").json()["parent_id"] is None


def test_unowned_content_hash_is_422(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    missing = sha(b"never uploaded")
    response = client.post(
        f"/api/documents/{doc.id}/versions",
        json={"parent_version_id": None, "content_hash": missing, "path": "Notes.md"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "blob_missing"
    assert response.json()["error"]["details"] == {"missing": [missing]}


def test_other_users_blob_is_not_owned(
    client: TestClient, other_client: TestClient, clean_db: Engine
) -> None:
    doc = make_doc(client, clean_db, "alice")
    sign_in(other_client, clean_db, "bob")
    bobs = upload(other_client, b"# bob's secret\n")
    response = client.post(
        f"/api/documents/{doc.id}/versions",
        json={"parent_version_id": None, "content_hash": bobs, "path": "Notes.md"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"] == {"missing": [bobs]}


def test_unowned_image_hash_is_422(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    missing = sha(b"no image")
    response = save(client, doc, None, images=[{"path": "images/a.png", "hash": missing}])
    assert response.status_code == 422
    assert response.json()["error"]["details"] == {"missing": [missing]}


def test_content_must_be_markdown_blob(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    image = upload(client, PNG, "image/png")
    response = client.post(
        f"/api/documents/{doc.id}/versions",
        json={"parent_version_id": None, "content_hash": image, "path": "Notes.md"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "blob_missing"


def test_duplicate_image_paths_ignore_case(client: TestClient, clean_db: Engine) -> None:
    # Review Focus 4: the local store treats names case-insensitively (P-008).
    doc = make_doc(client, clean_db)
    image = upload(client, PNG, "image/png")
    images = [{"path": "images/A.png", "hash": image}, {"path": "images/a.png", "hash": image}]
    assert save(client, doc, None, images=images).status_code == 422


def test_too_many_images_is_422(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    image = upload(client, PNG, "image/png")
    images = [{"path": f"images/{n}.png", "hash": image} for n in range(501)]
    assert save(client, doc, None, images=images).status_code == 422


def test_long_message_is_422(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    assert save(client, doc, None, message="x" * 501).status_code == 422
    assert save(client, doc, None, message="x" * 500).status_code == 201


def test_blank_message_becomes_null(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    assert save(client, doc, None, message="   ").json()["message"] is None


@pytest.mark.parametrize("bad", ["ABC", "A" * 64, "a" * 63])
def test_malformed_hash_is_422(client: TestClient, clean_db: Engine, bad: str) -> None:
    doc = make_doc(client, clean_db)
    response = client.post(
        f"/api/documents/{doc.id}/versions",
        json={"parent_version_id": None, "content_hash": bad, "path": "Notes.md"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_parent_must_be_stated(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    content = upload(client, b"# v\n")
    response = client.post(
        f"/api/documents/{doc.id}/versions", json={"content_hash": content, "path": "Notes.md"}
    )
    assert response.status_code == 422


def test_save_updates_document_path(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    assert save(client, doc, None, path="renamed/Doc.md").status_code == 201
    listed = client.get(f"/api/projects/{doc.project_id}/documents").json()
    assert listed[0]["path"] == "renamed/Doc.md"


def test_get_version_detail(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    image = upload(client, PNG, "image/png")
    v1 = save(client, doc, None, images=[{"path": "images/dot.png", "hash": image}]).json()["id"]
    body = client.get(f"/api/versions/{v1}").json()
    assert body["id"] == v1
    assert body["document_id"] == doc.id
    assert body["content_hash"] == sha(b"# v\n")
    assert body["images"] == [{"path": "images/dot.png", "hash": image}]


def test_list_versions_newest_first(client: TestClient, clean_db: Engine) -> None:
    doc = make_doc(client, clean_db)
    v1 = saved(client, doc, None)
    v2 = saved(client, doc, v1, b"# v2\n")
    listed = client.get(f"/api/documents/{doc.id}/versions").json()
    assert [(v["id"], v["number"], v["parent_id"]) for v in listed] == [(v2, 2, v1), (v1, 1, None)]
    assert set(listed[0]) == {"id", "number", "message", "parent_id", "created_at"}


def test_versions_of_other_users_are_404(
    client: TestClient, other_client: TestClient, clean_db: Engine
) -> None:
    doc = make_doc(client, clean_db, "alice")
    v1 = saved(client, doc, None)
    sign_in(other_client, clean_db, "bob")
    content = upload(other_client, b"# bob\n")
    assert other_client.get(f"/api/documents/{doc.id}/versions").status_code == 404
    response = other_client.post(
        f"/api/documents/{doc.id}/versions",
        json={"parent_version_id": v1, "content_hash": content, "path": "Notes.md"},
    )
    assert response.status_code == 404
    assert other_client.get(f"/api/versions/{v1}").status_code == 404
    assert other_client.delete(f"/api/versions/{v1}").status_code == 404
    assert client.get(f"/api/versions/{v1}").status_code == 200


def test_markdown_check_uses_the_savers_own_type(
    client: TestClient, other_client: TestClient, clean_db: Engine
) -> None:
    # Final review, Important 2: bytes another user stored as an image are still Markdown for
    # the user who uploaded them as Markdown.
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"/>'
    sign_in(other_client, clean_db, "bob")
    upload(other_client, svg, "image/svg+xml")
    doc = make_doc(client, clean_db, "alice")
    content = upload(client, svg, "text/markdown")
    response = client.post(
        f"/api/documents/{doc.id}/versions",
        json={"parent_version_id": None, "content_hash": content, "path": "Notes.md"},
    )
    assert response.status_code == 201, response.text

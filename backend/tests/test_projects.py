"""Projects API, scoped to the signed-in user (spec 5a 6.2)."""

import hashlib
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from app.db.models import UserBlob
from tests.support import sign_in

pytestmark = pytest.mark.integration


def create(client: TestClient, name: str = "Notes") -> dict[str, object]:
    response = client.post("/api/projects", json={"name": name})
    assert response.status_code == 201
    body: dict[str, object] = response.json()
    return body


def test_create_list_rename_delete_project(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    project = create(client, "  Notes  ")
    assert project["name"] == "Notes"
    assert project["document_count"] == 0
    renamed = client.patch(f"/api/projects/{project['id']}", json={"name": "Work"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Work"
    assert [p["id"] for p in client.get("/api/projects").json()] == [project["id"]]
    assert client.delete(f"/api/projects/{project['id']}").status_code == 204
    assert client.get("/api/projects").json() == []


def test_projects_newest_first(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    first = create(client, "First")
    second = create(client, "Second")
    assert [p["id"] for p in client.get("/api/projects").json()] == [second["id"], first["id"]]


def test_document_count(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    project = create(client)
    for path in ("a.md", "b.md"):
        client.post(f"/api/projects/{project['id']}/documents", json={"path": path})
    assert client.get("/api/projects").json()[0]["document_count"] == 2


@pytest.mark.parametrize("name", ["", "   ", "x" * 256])
def test_bad_project_name_is_422(client: TestClient, clean_db: Engine, name: str) -> None:
    sign_in(client, clean_db)
    response = client.post("/api/projects", json={"name": name})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_other_users_project_is_404(
    client: TestClient, other_client: TestClient, clean_db: Engine
) -> None:
    sign_in(client, clean_db, "alice")
    sign_in(other_client, clean_db, "bob")
    project_id = create(client)["id"]
    assert other_client.get("/api/projects").json() == []
    assert other_client.get(f"/api/projects/{project_id}/documents").status_code == 404
    assert other_client.patch(f"/api/projects/{project_id}", json={"name": "x"}).status_code == 404
    assert other_client.delete(f"/api/projects/{project_id}").status_code == 404
    response = other_client.post(f"/api/projects/{project_id}/documents", json={"path": "a.md"})
    assert response.status_code == 404
    assert client.get("/api/projects").json()[0]["name"] == "Notes"  # untouched


@pytest.mark.parametrize("project_id", ["nope", str(uuid.uuid4()), "1"])
def test_unknown_or_malformed_ids_are_404(
    client: TestClient, clean_db: Engine, project_id: str
) -> None:
    sign_in(client, clean_db)
    response = client.patch(f"/api/projects/{project_id}", json={"name": "x"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_deleting_project_keeps_users_blobs(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    data = b"# kept\n"
    client.put(
        f"/api/blobs/{hashlib.sha256(data).hexdigest()}",
        content=data,
        headers={"Content-Type": "text/markdown"},
    )
    client.delete(f"/api/projects/{create(client)['id']}")
    with Session(clean_db) as db:
        assert db.scalar(select(func.count()).select_from(UserBlob)) == 1

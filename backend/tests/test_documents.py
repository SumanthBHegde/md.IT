"""Documents API (spec 5a 6.3)."""

import re

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from tests.support import sign_in

pytestmark = pytest.mark.integration

UUID4 = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")


def project(client: TestClient) -> str:
    project_id: str = client.post("/api/projects", json={"name": "Notes"}).json()["id"]
    return project_id


def test_create_and_list_documents(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    project_id = project(client)
    created = client.post(f"/api/projects/{project_id}/documents", json={"path": "notes/b.md"})
    assert created.status_code == 201
    body = created.json()
    assert UUID4.fullmatch(body["id"])
    assert (body["path"], body["latest"]) == ("notes/b.md", None)
    client.post(f"/api/projects/{project_id}/documents", json={"path": "a.md"})
    listed = client.get(f"/api/projects/{project_id}/documents").json()
    assert [d["path"] for d in listed] == ["a.md", "notes/b.md"]
    assert all(d["latest"] is None for d in listed)


def test_same_path_twice_is_allowed(client: TestClient, clean_db: Engine) -> None:
    # Paths aren't unique (P-049): the client keeps its own tree consistent.
    sign_in(client, clean_db)
    project_id = project(client)
    for _ in range(2):
        response = client.post(f"/api/projects/{project_id}/documents", json={"path": "a.md"})
        assert response.status_code == 201
    assert len(client.get(f"/api/projects/{project_id}/documents").json()) == 2


@pytest.mark.parametrize("path", ["a.txt", "/a.md", "../a.md", ""])
def test_bad_document_path_is_422(client: TestClient, clean_db: Engine, path: str) -> None:
    sign_in(client, clean_db)
    response = client.post(f"/api/projects/{project(client)}/documents", json={"path": path})
    assert response.status_code == 422


def test_delete_document(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    project_id = project(client)
    doc = client.post(f"/api/projects/{project_id}/documents", json={"path": "a.md"}).json()
    assert client.delete(f"/api/documents/{doc['id']}").status_code == 204
    assert client.get(f"/api/projects/{project_id}/documents").json() == []
    assert client.delete(f"/api/documents/{doc['id']}").status_code == 404


def test_other_users_document_is_404(
    client: TestClient, other_client: TestClient, clean_db: Engine
) -> None:
    sign_in(client, clean_db, "alice")
    sign_in(other_client, clean_db, "bob")
    project_id = project(client)
    doc = client.post(f"/api/projects/{project_id}/documents", json={"path": "a.md"}).json()
    assert other_client.delete(f"/api/documents/{doc['id']}").status_code == 404
    assert len(client.get(f"/api/projects/{project_id}/documents").json()) == 1

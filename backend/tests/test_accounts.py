"""Deleting an account removes its versions and every blob nobody else owns (spec 5a 7.4)."""

import hashlib
import logging

import pytest
from azure.core.exceptions import AzureError
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Blob,
    Document,
    LoginSession,
    Project,
    User,
    UserBlob,
    Version,
    VersionImage,
)
from app.storage.blobs import BlobStore
from tests.support import sign_in

pytestmark = pytest.mark.integration

MD = b"# Alice's notes\n"
PNG = b"\x89PNG\r\n\x1a\n" + bytes(16)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def upload(client: TestClient, data: bytes, ctype: str) -> str:
    response = client.put(f"/api/blobs/{sha(data)}", content=data, headers={"Content-Type": ctype})
    assert response.status_code in (200, 201)
    return sha(data)


def alice_with_history(client: TestClient, engine: Engine) -> None:
    sign_in(client, engine, "alice")
    project = client.post("/api/projects", json={"name": "Notes"}).json()["id"]
    doc = client.post(f"/api/projects/{project}/documents", json={"path": "a.md"}).json()["id"]
    md, png = upload(client, MD, "text/markdown"), upload(client, PNG, "image/png")
    images = [{"path": "images/dot.png", "hash": png}]
    v1 = client.post(
        f"/api/documents/{doc}/versions",
        json={"parent_version_id": None, "content_hash": md, "path": "a.md", "images": images},
    ).json()["id"]
    client.post(
        f"/api/documents/{doc}/versions",
        json={"parent_version_id": v1, "content_hash": md, "path": "a.md", "images": images},
    )


def rows(engine: Engine, model: type) -> int:
    with Session(engine) as db:
        return db.scalar(select(func.count()).select_from(model)) or 0


def test_delete_account_removes_everything(
    client: TestClient, clean_db: Engine, blob_store: BlobStore
) -> None:
    alice_with_history(client, clean_db)
    response = client.delete("/api/me")
    assert response.status_code == 204
    assert "mdit_session=" in response.headers["set-cookie"]
    for model in (User, Project, Document, Version, VersionImage, LoginSession, UserBlob, Blob):
        assert rows(clean_db, model) == 0, model.__name__
    assert blob_store.get(sha(MD)) is None
    assert blob_store.get(sha(PNG)) is None
    assert client.get("/api/me").status_code == 401


def test_delete_account_keeps_blobs_others_own(
    client: TestClient, other_client: TestClient, clean_db: Engine, blob_store: BlobStore
) -> None:
    alice_with_history(client, clean_db)
    sign_in(other_client, clean_db, "bob")
    upload(other_client, PNG, "image/png")
    client.delete("/api/me")
    with Session(clean_db) as db:
        assert db.get(Blob, sha(PNG)) is not None
        assert db.get(Blob, sha(MD)) is None
    assert blob_store.get(sha(PNG)) == PNG
    assert blob_store.get(sha(MD)) is None
    assert other_client.get(f"/api/blobs/{sha(PNG)}").content == PNG


def test_delete_account_ends_every_session(
    client: TestClient, other_client: TestClient, clean_db: Engine
) -> None:
    sign_in(client, clean_db, "alice")
    sign_in(other_client, clean_db, "alice")
    client.delete("/api/me")
    assert other_client.get("/api/me").status_code == 401


def test_storage_failure_keeps_the_row(
    client: TestClient,
    clean_db: Engine,
    blob_store: BlobStore,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    alice_with_history(client, clean_db)

    def unavailable(self: BlobStore, hash: str) -> None:
        raise AzureError("storage is down")

    monkeypatch.setattr(BlobStore, "delete", unavailable)
    with caplog.at_level(logging.WARNING):
        assert client.delete("/api/me").status_code == 204
    assert rows(clean_db, User) == 0  # the account is gone either way
    assert rows(clean_db, Blob) == 2  # left for the cleanup job
    assert "left for cleanup" in caplog.text

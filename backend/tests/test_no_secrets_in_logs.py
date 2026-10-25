"""No log line carries a session token or document content (PRD 12, acceptance 7)."""

import hashlib
import logging

import pytest
from fastapi.testclient import TestClient

from app.auth import SESSION_COOKIE

pytestmark = pytest.mark.integration

CONTENT = b"# SECRET-CONTENT-123\n"


def test_auth_and_save_flow_logs_no_secrets(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    client.get("/api/auth/login/dev?name=logcheck", follow_redirects=False)
    token = client.cookies.get(SESSION_COOKIE)
    assert token
    project = client.post("/api/projects", json={"name": "SECRET-PROJECT"}).json()["id"]
    doc = client.post(f"/api/projects/{project}/documents", json={"path": "SECRET-PATH.md"})
    content_hash = hashlib.sha256(CONTENT).hexdigest()
    client.put(
        f"/api/blobs/{content_hash}", content=CONTENT, headers={"Content-Type": "text/markdown"}
    )
    saved = client.post(
        f"/api/documents/{doc.json()['id']}/versions",
        json={
            "parent_version_id": None,
            "content_hash": content_hash,
            "path": "SECRET-PATH.md",
            "message": "SECRET-MESSAGE",
        },
    )
    assert saved.status_code == 201
    stale = client.post(  # a failure path too
        f"/api/documents/{doc.json()['id']}/versions",
        json={"parent_version_id": None, "content_hash": content_hash, "path": "SECRET-PATH.md"},
    )
    assert stale.status_code == 409
    client.post("/api/auth/logout")
    text = caplog.text
    for secret in (token, "SECRET-CONTENT-123", "SECRET-MESSAGE", "SECRET-PATH", "SECRET-PROJECT"):
        assert secret not in text, secret

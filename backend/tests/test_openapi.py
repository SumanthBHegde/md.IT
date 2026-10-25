"""The OpenAPI schema 5b generates its client from (spec 5a 6.1, acceptance 6)."""

import re

from fastapi.testclient import TestClient

from app.main import create_app
from tests.support import fake_settings

ROUTES = {
    ("GET", "/api/health"),
    ("GET", "/api/health/ready"),
    ("GET", "/api/auth/providers"),
    ("GET", "/api/auth/login/{provider}"),
    ("GET", "/api/auth/callback/{provider}"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/me"),
    ("DELETE", "/api/me"),
    ("GET", "/api/projects"),
    ("POST", "/api/projects"),
    ("PATCH", "/api/projects/{project_id}"),
    ("DELETE", "/api/projects/{project_id}"),
    ("GET", "/api/projects/{project_id}/documents"),
    ("POST", "/api/projects/{project_id}/documents"),
    ("DELETE", "/api/documents/{document_id}"),
    ("GET", "/api/documents/{document_id}/versions"),
    ("POST", "/api/documents/{document_id}/versions"),
    ("GET", "/api/versions/{version_id}"),
    ("DELETE", "/api/versions/{version_id}"),
    ("HEAD", "/api/blobs/{hash}"),
    ("PUT", "/api/blobs/{hash}"),
    ("GET", "/api/blobs/{hash}"),
}


def operations() -> dict[tuple[str, str], dict[str, object]]:
    spec = create_app(fake_settings()).openapi()
    return {
        (method.upper(), path): operation
        for path, methods in spec["paths"].items()
        for method, operation in methods.items()
    }


def test_openapi_lists_exactly_the_5a_routes() -> None:
    assert set(operations()) == ROUTES


def test_every_operation_has_a_camel_case_unique_id() -> None:
    ids = [str(operation.get("operationId")) for operation in operations().values()]
    assert len(ids) == len(set(ids))
    bad = [i for i in ids if not re.fullmatch(r"[a-z][A-Za-z]+", i)]
    assert bad == []


def test_every_operation_documents_its_success() -> None:
    missing = [
        key
        for key, operation in operations().items()
        if not any(str(code).startswith(("2", "302")) for code in operation["responses"])  # type: ignore[attr-defined]
    ]
    assert missing == []


def test_openapi_served_under_api() -> None:
    response = TestClient(create_app(fake_settings())).get("/api/openapi.json")
    assert response.status_code == 200
    assert response.json()["paths"]["/api/projects"]["get"]["operationId"] == "listProjects"

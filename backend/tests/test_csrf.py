"""Mutating /api requests need the X-MdIt-CSRF header (P-064). No services needed."""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.support import TEST_BASE_URL, fake_settings


def make_client() -> TestClient:
    # No `with`: the lifespan (blob container) never runs, so nothing needs Azurite.
    return TestClient(create_app(fake_settings()), base_url=TEST_BASE_URL)


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_mutating_api_request_without_header_is_403(method: str) -> None:
    response = make_client().request(method, "/api/nothing-here")
    assert response.status_code == 403
    assert response.json() == {
        "error": {"code": "csrf", "message": "This request is missing its CSRF header."}
    }


def test_wrong_header_value_is_403() -> None:
    response = make_client().post("/api/nothing-here", headers={"X-MdIt-CSRF": "0"})
    assert response.status_code == 403


def test_safe_methods_need_no_header() -> None:
    assert make_client().get("/api/health").status_code == 200


def test_header_lets_the_request_through() -> None:
    response = make_client().post("/api/nothing-here", headers={"X-MdIt-CSRF": "1"})
    assert response.status_code == 404


def test_paths_outside_api_are_not_checked() -> None:
    assert make_client().post("/elsewhere").status_code == 404

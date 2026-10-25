"""GET /api/me and logout over HTTP."""

import re
from http.cookies import SimpleCookie

import pytest
from fastapi.responses import Response
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from app.auth import SESSION_COOKIE, clear_session_cookie, set_session_cookie
from app.db.models import LoginSession
from tests.support import fake_settings, sign_in

pytestmark = pytest.mark.integration

ISO_UTC = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z")


def session_rows(engine: Engine) -> int:
    with Session(engine) as db:
        return db.scalar(select(func.count()).select_from(LoginSession)) or 0


def test_me_needs_a_session(client: TestClient) -> None:
    response = client.get("/api/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


def test_me_returns_the_account(client: TestClient, clean_db: Engine) -> None:
    user = sign_in(client, clean_db, "alice")
    body = client.get("/api/me").json()
    assert body["id"] == user.public_id
    assert (body["provider"], body["email"]) == ("dev", None)
    assert ISO_UTC.fullmatch(body["created_at"])


def test_unknown_cookie_is_401(client: TestClient) -> None:
    client.cookies.set(SESSION_COOKIE, "forged-token")
    assert client.get("/api/me").status_code == 401


def test_logout_ends_the_session(client: TestClient, clean_db: Engine) -> None:
    sign_in(client, clean_db)
    response = client.post("/api/auth/logout")
    assert response.status_code == 204
    assert f"{SESSION_COOKIE}=" in response.headers["set-cookie"]
    assert "max-age=0" in response.headers["set-cookie"].lower()
    assert session_rows(clean_db) == 0
    assert client.get("/api/me").status_code == 401


def test_logout_without_session_is_204(client: TestClient) -> None:
    assert client.post("/api/auth/logout").status_code == 204


def test_two_devices_have_independent_sessions(
    client: TestClient, other_client: TestClient, clean_db: Engine
) -> None:
    sign_in(client, clean_db, "alice")
    sign_in(other_client, clean_db, "alice")
    client.post("/api/auth/logout")
    assert client.get("/api/me").status_code == 401
    assert other_client.get("/api/me").status_code == 200


def cookie_from(response: Response) -> SimpleCookie:
    cookie: SimpleCookie = SimpleCookie()
    cookie.load(response.headers["set-cookie"])
    return cookie


def test_session_cookie_attributes() -> None:
    response = Response()
    set_session_cookie(response, "tok", fake_settings())
    morsel = cookie_from(response)[SESSION_COOKIE]
    assert morsel.value == "tok"
    assert morsel["httponly"] and morsel["secure"]
    assert morsel["samesite"].lower() == "lax"
    assert morsel["path"] == "/api"
    assert morsel["max-age"] == str(30 * 86400)


def test_session_cookie_not_secure_when_configured() -> None:
    response = Response()
    set_session_cookie(response, "tok", fake_settings(cookie_secure=False))
    assert not cookie_from(response)[SESSION_COOKIE]["secure"]


def test_clearing_the_cookie_matches_its_path() -> None:
    response = Response()
    clear_session_cookie(response, fake_settings())
    morsel = cookie_from(response)[SESSION_COOKIE]
    assert morsel["path"] == "/api" and morsel["max-age"] == "0"

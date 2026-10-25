"""Sign-in routes: providers list, OAuth login and callback, dev login (spec 5a 5.1–5.2)."""

import logging
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from app.auth import SESSION_COOKIE, safe_next
from app.db.models import User
from app.services.oauth import Identity
from tests.conftest import AppFactory, api_client
from tests.support import FakeProvider

pytestmark = pytest.mark.integration


def start(client: TestClient, provider: str = "github", next_: str | None = "/p/1") -> str:
    """Begin a login; return the state the provider would echo back."""
    url = f"/api/auth/login/{provider}" + (f"?next={next_}" if next_ is not None else "")
    response = client.get(url, follow_redirects=False)
    assert response.status_code == 302
    return parse_qs(urlparse(response.headers["location"]).query)["state"][0]


def callback(client: TestClient, query: str, provider: str = "github") -> str:
    response = client.get(f"/api/auth/callback/{provider}?{query}", follow_redirects=False)
    assert response.status_code == 302
    return response.headers["location"]


def users(engine: Engine) -> int:
    with Session(engine) as db:
        return db.scalar(select(func.count()).select_from(User)) or 0


def test_providers_lists_enabled_ones(client: TestClient) -> None:
    assert client.get("/api/auth/providers").json() == {"providers": ["github", "dev"]}


def test_providers_without_dev_login(make_app: AppFactory) -> None:
    app = make_app(providers={"github": FakeProvider()}, dev_login=False)
    assert api_client(app).get("/api/auth/providers").json() == {"providers": ["github"]}


def test_login_redirects_to_provider_with_state(
    client: TestClient, fake_provider: FakeProvider
) -> None:
    response = client.get("/api/auth/login/github?next=/p/1", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"].startswith("https://provider.test/authorize?state=")
    cookie = response.headers["set-cookie"].lower()
    assert cookie.startswith("mdit_oauth=")
    assert "path=/api/auth" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert "secure" in cookie
    assert fake_provider.last_verifier is not None and len(fake_provider.last_verifier) >= 43


def test_each_login_gets_a_new_state(client: TestClient) -> None:
    assert start(client) != start(client)


@pytest.mark.parametrize("provider", ["google", "nope"])
def test_unknown_or_disabled_provider_is_404(client: TestClient, provider: str) -> None:
    response = client.get(f"/api/auth/login/{provider}", follow_redirects=False)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_callback_signs_in_and_redirects_to_next(
    client: TestClient, fake_provider: FakeProvider
) -> None:
    state = start(client, next_="/p/1")
    response = client.get(
        f"/api/auth/callback/github?code=abc&state={state}", follow_redirects=False
    )
    assert response.headers["location"] == "/p/1"
    assert f"{SESSION_COOKIE}=" in response.headers["set-cookie"]
    assert fake_provider.last_code == "abc"
    me = client.get("/api/me").json()
    assert (me["provider"], me["email"]) == ("github", "alice@example.com")


def test_callback_reuses_the_existing_user_and_updates_email(
    client: TestClient, fake_provider: FakeProvider, clean_db: Engine
) -> None:
    callback(client, f"code=a&state={start(client)}")
    fake_provider.identity = Identity("github", "1001", "new@example.com")
    callback(client, f"code=b&state={start(client)}")
    assert users(clean_db) == 1
    assert client.get("/api/me").json()["email"] == "new@example.com"


def test_callback_with_wrong_state(client: TestClient) -> None:
    start(client)
    assert callback(client, "code=abc&state=forged") == "/?login_error=state"
    assert client.get("/api/me").status_code == 401


def test_callback_without_state_cookie(client: TestClient) -> None:
    # Review Focus 2: the 10-minute cookie expired, or the link opened in another browser.
    assert callback(client, "code=abc&state=anything") == "/?login_error=state"


def test_callback_for_another_provider_is_a_state_error(make_app: AppFactory) -> None:
    app = make_app(providers={"github": FakeProvider(), "google": FakeProvider("google")})
    client = api_client(app)
    state = start(client, "github")
    assert callback(client, f"code=abc&state={state}", "google") == "/?login_error=state"


def test_state_is_single_use(client: TestClient) -> None:
    state = start(client)
    assert callback(client, f"code=abc&state={state}") == "/p/1"
    client.cookies.delete(SESSION_COOKIE)
    assert callback(client, f"code=abc&state={state}") == "/?login_error=state"


def test_callback_denied(client: TestClient) -> None:
    start(client)
    assert callback(client, "error=access_denied") == "/?login_error=denied"


def test_callback_other_provider_error(client: TestClient) -> None:
    start(client)
    assert callback(client, "error=server_error") == "/?login_error=provider"


def test_callback_without_code_is_a_provider_error(client: TestClient) -> None:
    assert callback(client, f"state={start(client)}") == "/?login_error=provider"


def test_callback_provider_failure(make_app: AppFactory, caplog: pytest.LogCaptureFixture) -> None:
    client = api_client(make_app(providers={"github": FakeProvider(error=True)}))
    with caplog.at_level(logging.WARNING):
        assert callback(client, f"code=c0de-secret&state={start(client)}") == (
            "/?login_error=provider"
        )
    assert "Sign-in failed: provider (github)" in caplog.text
    assert "c0de-secret" not in caplog.text


def test_callback_for_unconfigured_provider_is_404(client: TestClient) -> None:
    response = client.get("/api/auth/callback/google?code=a&state=b", follow_redirects=False)
    assert response.status_code == 404


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("/p/1", "/p/1"),
        ("/p/1?x=1#y", "/p/1?x=1#y"),
        ("//evil.example", "/"),
        ("/\\evil.example", "/"),
        ("https://evil.example", "/"),
        ("evil", "/"),
        ("", "/"),
        (None, "/"),
        ("/" + "a" * 2048, "/"),
        ("/" + "a" * 2047, "/" + "a" * 2047),
    ],
)
def test_safe_next(value: str | None, expected: str) -> None:
    assert safe_next(value) == expected


def test_unsafe_next_falls_back_to_root(client: TestClient) -> None:
    state = start(client, next_="//evil.example")
    assert callback(client, f"code=a&state={state}") == "/"


def test_dev_login(client: TestClient) -> None:
    response = client.get("/api/auth/login/dev?name=alice&next=/p/2", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/p/2"
    me = client.get("/api/me").json()
    assert (me["provider"], me["email"]) == ("dev", None)


def test_dev_login_same_name_is_the_same_user(
    client: TestClient, other_client: TestClient, clean_db: Engine
) -> None:
    client.get("/api/auth/login/dev?name=alice", follow_redirects=False)
    other_client.get("/api/auth/login/dev?name=alice", follow_redirects=False)
    assert client.get("/api/me").json()["id"] == other_client.get("/api/me").json()["id"]
    assert users(clean_db) == 1


@pytest.mark.parametrize("name", ["", "Alice", "a b", "x" * 65, "ä"])
def test_dev_login_rejects_bad_names(client: TestClient, name: str) -> None:
    response = client.get(f"/api/auth/login/dev?name={name}", follow_redirects=False)
    assert response.status_code == 422


def test_dev_login_needs_a_name(client: TestClient) -> None:
    assert client.get("/api/auth/login/dev", follow_redirects=False).status_code == 422


def test_dev_login_off_is_404(make_app: AppFactory) -> None:
    client = api_client(make_app(dev_login=False))
    response = client.get("/api/auth/login/dev?name=alice", follow_redirects=False)
    assert response.status_code == 404


def test_dev_login_warning_logged(make_app: AppFactory, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING):
        make_app(dev_login=True)
    assert "DEV_LOGIN is on" in caplog.text

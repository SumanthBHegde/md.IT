"""GitHub and Google identity providers against mocked HTTP (P-067). No network."""

import base64
import hashlib
from collections.abc import Callable
from urllib.parse import parse_qs, urlparse

import httpx2
import pytest
from pydantic import SecretStr

from app.main import create_app
from app.services.oauth import (
    GitHubProvider,
    GoogleProvider,
    Identity,
    ProviderError,
    build_providers,
)
from tests.support import FakeProvider, fake_settings

REDIRECT = "https://mdit.example/api/auth/callback/github"
VERIFIER = "v" * 64

Handler = Callable[[httpx2.Request], httpx2.Response]


def recording(routes: dict[str, Handler]) -> tuple[httpx2.MockTransport, list[httpx2.Request]]:
    seen: list[httpx2.Request] = []

    def handle(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        handler = routes.get(request.url.path)
        return handler(request) if handler else httpx2.Response(404)

    return httpx2.MockTransport(handle), seen


def respond(status: int, body: object) -> Handler:
    return lambda request: httpx2.Response(status, json=body)


TOKEN = respond(200, {"access_token": "gho_token", "token_type": "bearer"})


def query(url: str) -> dict[str, list[str]]:
    return parse_qs(urlparse(url).query)


def challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def github(routes: dict[str, Handler]) -> tuple[GitHubProvider, list[httpx2.Request]]:
    transport, seen = recording(routes)
    return GitHubProvider("cid", "csecret", transport=transport), seen


def google(routes: dict[str, Handler]) -> tuple[GoogleProvider, list[httpx2.Request]]:
    transport, seen = recording(routes)
    return GoogleProvider("gid", "gsecret", transport=transport), seen


def test_github_authorization_url_uses_pkce_s256() -> None:
    url = GitHubProvider("cid", "csecret").authorization_url(REDIRECT, "st", VERIFIER)
    assert url.startswith("https://github.com/login/oauth/authorize?")
    q = query(url)
    assert q["state"] == ["st"]
    assert q["client_id"] == ["cid"]
    assert q["redirect_uri"] == [REDIRECT]
    assert q["scope"] == ["read:user user:email"]
    assert q["code_challenge_method"] == ["S256"]
    assert q["code_challenge"] == [challenge(VERIFIER)]


def test_github_identity_uses_primary_verified_email() -> None:
    provider, seen = github(
        {
            "/login/oauth/access_token": TOKEN,
            "/user": respond(200, {"id": 42, "login": "octo"}),
            "/user/emails": respond(
                200,
                [
                    {"email": "other@x.io", "primary": False, "verified": True},
                    {"email": "primary@x.io", "primary": True, "verified": True},
                ],
            ),
        }
    )
    assert provider.fetch_identity(REDIRECT, "the-code", VERIFIER) == Identity(
        "github", "42", "primary@x.io"
    )
    token_body = parse_qs(seen[0].content.decode())
    assert token_body["code"] == ["the-code"]
    assert token_body["code_verifier"] == [VERIFIER]
    assert token_body["client_id"] == ["cid"]
    assert token_body["client_secret"] == ["csecret"]
    assert token_body["redirect_uri"] == [REDIRECT]
    assert seen[1].headers["authorization"] == "Bearer gho_token"


def test_github_unverified_primary_email_is_null() -> None:
    provider, _ = github(
        {
            "/login/oauth/access_token": TOKEN,
            "/user": respond(200, {"id": 42}),
            "/user/emails": respond(
                200, [{"email": "primary@x.io", "primary": True, "verified": False}]
            ),
        }
    )
    assert provider.fetch_identity(REDIRECT, "c", VERIFIER).email is None


def test_github_email_lookup_failure_gives_null_email() -> None:
    # Review Focus 5: the user:email scope wasn't granted, or the endpoint fails.
    provider, _ = github(
        {
            "/login/oauth/access_token": TOKEN,
            "/user": respond(200, {"id": 42}),
            "/user/emails": respond(404, {"message": "Not Found"}),
        }
    )
    assert provider.fetch_identity(REDIRECT, "c", VERIFIER) == Identity("github", "42", None)


def test_github_token_error_raises_provider_error() -> None:
    provider, _ = github(
        {"/login/oauth/access_token": respond(200, {"error": "bad_verification_code"})}
    )
    with pytest.raises(ProviderError) as info:
        provider.fetch_identity(REDIRECT, "secret-code-value", VERIFIER)
    assert "secret-code-value" not in str(info.value)


def test_github_user_failure_raises_provider_error() -> None:
    provider, _ = github(
        {"/login/oauth/access_token": TOKEN, "/user": respond(500, {"message": "boom"})}
    )
    with pytest.raises(ProviderError):
        provider.fetch_identity(REDIRECT, "c", VERIFIER)


def test_github_user_without_id_raises_provider_error() -> None:
    provider, _ = github({"/login/oauth/access_token": TOKEN, "/user": respond(200, {})})
    with pytest.raises(ProviderError):
        provider.fetch_identity(REDIRECT, "c", VERIFIER)


def test_google_authorization_url() -> None:
    url = GoogleProvider("gid", "gsecret").authorization_url(REDIRECT, "st", VERIFIER)
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    q = query(url)
    assert q["scope"] == ["openid email"]
    assert q["code_challenge"] == [challenge(VERIFIER)]


def test_google_identity_from_userinfo() -> None:
    provider, seen = google(
        {
            "/token": TOKEN,
            "/v1/userinfo": respond(200, {"sub": "g-1", "email": "a@x.io", "email_verified": True}),
        }
    )
    assert provider.fetch_identity(REDIRECT, "c", VERIFIER) == Identity("google", "g-1", "a@x.io")
    assert seen[0].url.host == "oauth2.googleapis.com"
    assert seen[1].url.host == "openidconnect.googleapis.com"


def test_google_unverified_email_is_null() -> None:
    provider, _ = google(
        {
            "/token": TOKEN,
            "/v1/userinfo": respond(
                200, {"sub": "g-1", "email": "a@x.io", "email_verified": False}
            ),
        }
    )
    assert provider.fetch_identity(REDIRECT, "c", VERIFIER).email is None


def test_google_network_error_raises_provider_error() -> None:
    def fail(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("unreachable", request=request)

    provider, _ = google({"/token": fail})
    with pytest.raises(ProviderError):
        provider.fetch_identity(REDIRECT, "c", VERIFIER)


def test_google_bad_json_raises_provider_error() -> None:
    provider, _ = google(
        {
            "/token": TOKEN,
            "/v1/userinfo": lambda request: httpx2.Response(200, content=b"<html>"),
        }
    )
    with pytest.raises(ProviderError):
        provider.fetch_identity(REDIRECT, "c", VERIFIER)


def test_build_providers_follows_settings() -> None:
    assert build_providers(fake_settings()) == {}
    only_github = fake_settings(github_client_id="i", github_client_secret=SecretStr("s"))
    assert list(build_providers(only_github)) == ["github"]
    both = fake_settings(
        github_client_id="i",
        github_client_secret=SecretStr("s"),
        google_client_id="g",
        google_client_secret=SecretStr("t"),
    )
    assert list(build_providers(both)) == ["github", "google"]


def test_app_builds_providers_from_settings() -> None:
    app = create_app(fake_settings(github_client_id="i", github_client_secret=SecretStr("s")))
    assert list(app.state.providers) == ["github"]


def test_app_takes_given_providers() -> None:
    fake = FakeProvider()
    assert create_app(fake_settings(), providers={"github": fake}).state.providers == {
        "github": fake
    }


def test_fake_provider_records_and_returns() -> None:
    fake = FakeProvider()
    assert (
        fake.authorization_url(REDIRECT, "st", VERIFIER)
        == "https://provider.test/authorize?state=st"
    )
    assert fake.fetch_identity(REDIRECT, "c0de", VERIFIER) == Identity(
        "github", "1001", "alice@example.com"
    )
    assert (fake.last_code, fake.last_verifier) == ("c0de", VERIFIER)
    with pytest.raises(ProviderError):
        FakeProvider(error=True).fetch_identity(REDIRECT, "c", VERIFIER)

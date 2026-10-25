"""OAuth identity providers (P-058, P-068): GitHub and Google with PKCE.

Authlib's synchronous OAuth2Client (built on httpx2) talks to the provider. Errors never
carry the authorization code or tokens.
"""

from typing import Any, NamedTuple, Protocol

import httpx2
from authlib.integrations.base_client import OAuthError
from authlib.integrations.httpx_client import OAuth2Client

from app.config import OAuthProvider, Settings, oauth_credentials

TIMEOUT = 10


class Identity(NamedTuple):
    provider: str  # "github" | "google" | "dev"
    provider_user_id: str
    email: str | None


class ProviderError(Exception):
    """Sign-in with the provider failed; the message names only what kind of step failed."""


class IdentityProvider(Protocol):
    name: str

    def authorization_url(self, redirect_uri: str, state: str, code_verifier: str) -> str: ...

    def fetch_identity(self, redirect_uri: str, code: str, code_verifier: str) -> Identity: ...


class _OAuthProvider:
    name: str
    authorize_url: str
    token_url: str
    scope: str

    def __init__(
        self, client_id: str, client_secret: str, transport: httpx2.BaseTransport | None = None
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._transport = transport

    def _client(self, redirect_uri: str) -> OAuth2Client:
        return OAuth2Client(
            client_id=self._client_id,
            client_secret=self._client_secret,
            scope=self.scope,
            redirect_uri=redirect_uri,
            code_challenge_method="S256",
            token_endpoint_auth_method="client_secret_post",
            timeout=TIMEOUT,
            transport=self._transport,
        )

    def authorization_url(self, redirect_uri: str, state: str, code_verifier: str) -> str:
        with self._client(redirect_uri) as client:
            url, _ = client.create_authorization_url(
                self.authorize_url, state=state, code_verifier=code_verifier
            )
        return str(url)

    def fetch_identity(self, redirect_uri: str, code: str, code_verifier: str) -> Identity:
        try:
            with self._client(redirect_uri) as client:
                client.fetch_token(self.token_url, code=code, code_verifier=code_verifier)
                return self._identity(client)
        except ProviderError:
            raise
        except (OAuthError, httpx2.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise ProviderError(f"{self.name}: {type(exc).__name__}") from None

    def _identity(self, client: OAuth2Client) -> Identity:
        raise NotImplementedError

    def _get_json(self, client: OAuth2Client, url: str, **kwargs: Any) -> Any:
        response = client.get(url, **kwargs)
        response.raise_for_status()
        return response.json()


class GitHubProvider(_OAuthProvider):
    name = "github"
    authorize_url = "https://github.com/login/oauth/authorize"
    token_url = "https://github.com/login/oauth/access_token"
    user_url = "https://api.github.com/user"
    emails_url = "https://api.github.com/user/emails"
    scope = "read:user user:email"
    headers = {"Accept": "application/vnd.github+json"}

    def _identity(self, client: OAuth2Client) -> Identity:
        user = self._get_json(client, self.user_url, headers=self.headers)
        user_id = user.get("id") if isinstance(user, dict) else None
        if user_id is None:
            raise ProviderError("github: user has no id")
        return Identity(self.name, str(user_id), self._email(client))

    def _email(self, client: OAuth2Client) -> str | None:
        # Optional: without the user:email grant, or if GitHub fails here, sign in without it.
        try:
            emails = self._get_json(client, self.emails_url, headers=self.headers)
        except httpx2.HTTPError, ValueError:
            return None
        if not isinstance(emails, list):
            return None
        for entry in emails:
            if isinstance(entry, dict) and entry.get("primary") and entry.get("verified"):
                email = entry.get("email")
                return email if isinstance(email, str) else None
        return None


class GoogleProvider(_OAuthProvider):
    """OpenID Connect scopes with fixed endpoints; the access token comes straight from
    Google's token endpoint over TLS, so userinfo needs no id-token check (P-068)."""

    name = "google"
    authorize_url = "https://accounts.google.com/o/oauth2/v2/auth"
    token_url = "https://oauth2.googleapis.com/token"
    userinfo_url = "https://openidconnect.googleapis.com/v1/userinfo"
    scope = "openid email"

    def _identity(self, client: OAuth2Client) -> Identity:
        info = self._get_json(client, self.userinfo_url)
        subject = info.get("sub") if isinstance(info, dict) else None
        if not isinstance(subject, str) or not subject:
            raise ProviderError("google: userinfo has no subject")
        email = info.get("email") if info.get("email_verified") is True else None
        return Identity(self.name, subject, email if isinstance(email, str) else None)


PROVIDER_CLASSES: tuple[tuple[OAuthProvider, type[_OAuthProvider]], ...] = (
    ("github", GitHubProvider),
    ("google", GoogleProvider),
)


def build_providers(settings: Settings) -> dict[str, IdentityProvider]:
    """The configured providers, in the order the sign-in buttons show them."""
    providers: dict[str, IdentityProvider] = {}
    for name, cls in PROVIDER_CLASSES:
        credentials = oauth_credentials(settings, name)
        if credentials is not None:
            providers[name] = cls(*credentials)
    return providers

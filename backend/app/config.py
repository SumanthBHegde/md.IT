"""Settings read from environment variables only (PRD section 10.4, P-052)."""

from typing import Literal, Self

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR"]
OAuthProvider = Literal["github", "google"]


class DatabaseSettings(BaseSettings):
    """What migrations need: database credentials and nothing else."""

    # hide_input_in_errors: a missing variable must not echo the others (secrets) into logs.
    model_config = SettingsConfigDict(frozen=True, extra="ignore", hide_input_in_errors=True)

    db_host: str
    db_port: int = 3306
    db_name: str = "mdit"
    db_user: str = "mdit"
    db_password: SecretStr


class Settings(DatabaseSettings):
    blob_connection_string: SecretStr
    blob_container: str = "mdit-blobs"
    log_level: LogLevel = "INFO"

    # Sign-in (spec 5a section 10).
    public_base_url: str
    session_secret: SecretStr
    session_days: int = Field(30, ge=1, le=365)
    cookie_secure: bool = True
    github_client_id: str | None = None
    github_client_secret: SecretStr | None = None
    google_client_id: str | None = None
    google_client_secret: SecretStr | None = None
    dev_login: bool = False

    @field_validator("log_level", mode="before")
    @classmethod
    def _upper(cls, value: object) -> object:
        return value.upper() if isinstance(value, str) else value

    @field_validator(
        "github_client_id",
        "github_client_secret",
        "google_client_id",
        "google_client_secret",
        mode="before",
    )
    @classmethod
    def _blank_is_unset(cls, value: object) -> object:
        # Compose passes unset variables through as empty strings.
        return None if value == "" else value

    @field_validator("public_base_url")
    @classmethod
    def _base_url(cls, value: str) -> str:
        if not value.startswith(("http://", "https://")):
            raise ValueError("PUBLIC_BASE_URL must start with http:// or https://")
        return value.rstrip("/")

    @field_validator("session_secret")
    @classmethod
    def _long_secret(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < 32:
            raise ValueError("SESSION_SECRET must be at least 32 characters")
        return value

    @model_validator(mode="after")
    def _provider_pairs(self) -> Self:
        for name in ("github", "google"):
            client_id = getattr(self, f"{name}_client_id")
            secret = getattr(self, f"{name}_client_secret")
            if client_id and not secret:
                raise ValueError(f"{name.upper()}_CLIENT_SECRET is missing")
            if secret and not client_id:
                raise ValueError(f"{name.upper()}_CLIENT_ID is missing")
        return self


def oauth_credentials(settings: Settings, name: OAuthProvider) -> tuple[str, str] | None:
    """Client ID and secret when the provider is configured, else None."""
    client_id: str | None = getattr(settings, f"{name}_client_id")
    secret: SecretStr | None = getattr(settings, f"{name}_client_secret")
    if client_id is None or secret is None:
        return None
    return client_id, secret.get_secret_value()


def database_url(settings: DatabaseSettings) -> URL:
    """Built, not formatted, so passwords need no escaping."""
    return URL.create(
        "mysql+pymysql",
        username=settings.db_user,
        password=settings.db_password.get_secret_value(),
        host=settings.db_host,
        port=settings.db_port,
        database=settings.db_name,
        query={"charset": "utf8mb4"},
    )

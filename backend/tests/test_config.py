"""Settings come only from environment variables (PRD 10.4, P-052)."""

import pytest
from pydantic import ValidationError

from app.config import DatabaseSettings, Settings, database_url, oauth_credentials

NAMES = [
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "BLOB_CONNECTION_STRING",
    "BLOB_CONTAINER",
    "LOG_LEVEL",
    "PUBLIC_BASE_URL",
    "SESSION_SECRET",
    "SESSION_DAYS",
    "COOKIE_SECURE",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "DEV_LOGIN",
]
SESSION_SECRET = "s" * 32
REQUIRED = {
    "DB_HOST": "db.internal",
    "DB_PASSWORD": "secret-password",
    "BLOB_CONNECTION_STRING": "UseDevelopmentStorage=true",
    "PUBLIC_BASE_URL": "https://mdit.example",
    "SESSION_SECRET": SESSION_SECRET,
}


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch):
    for name in NAMES:
        monkeypatch.delenv(name, raising=False)

    def set_env(**values: str) -> None:
        for name, value in values.items():
            monkeypatch.setenv(name, value)

    return set_env


def test_reads_required_values_and_defaults(env) -> None:
    env(**REQUIRED)
    settings = Settings()
    assert settings.db_host == "db.internal"
    assert settings.db_port == 3306
    assert settings.db_name == "mdit"
    assert settings.db_user == "mdit"
    assert settings.db_password.get_secret_value() == "secret-password"
    assert settings.blob_container == "mdit-blobs"
    assert settings.log_level == "INFO"


def test_missing_required_values_fail(env) -> None:
    with pytest.raises(ValidationError) as info:
        Settings()
    missing = {error["loc"][0] for error in info.value.errors()}
    assert missing == {
        "db_host",
        "db_password",
        "blob_connection_string",
        "public_base_url",
        "session_secret",
    }


def test_configuration_errors_do_not_print_secrets(env) -> None:
    # DB_HOST missing: the error must name it without echoing the other values it was given.
    env(DB_PASSWORD="hunter2-password", BLOB_CONNECTION_STRING="AccountKey=sekret-key")
    with pytest.raises(ValidationError) as info:
        Settings()
    message = str(info.value)
    assert "db_host" in message
    assert "hunter2" not in message
    assert "sekret" not in message


def test_secrets_stay_out_of_repr(env) -> None:
    env(**REQUIRED)
    text = repr(Settings())
    assert "secret-password" not in text
    assert "UseDevelopmentStorage" not in text


def test_log_level_ignores_case(env) -> None:
    env(**REQUIRED, LOG_LEVEL="debug")
    assert Settings().log_level == "DEBUG"


def test_rejects_an_unknown_log_level(env) -> None:
    env(**REQUIRED, LOG_LEVEL="loud")
    with pytest.raises(ValidationError):
        Settings()


def test_database_url_keeps_special_characters_in_password(env) -> None:
    env(**{**REQUIRED, "DB_PASSWORD": "p@ss:/w#rd%", "DB_PORT": "3307"})
    url = database_url(Settings())
    assert url.drivername == "mysql+pymysql"
    assert url.username == "mdit"
    assert url.password == "p@ss:/w#rd%"
    assert url.host == "db.internal"
    assert url.port == 3307
    assert url.database == "mdit"
    assert dict(url.query) == {"charset": "utf8mb4"}
    assert "p@ss" not in url.render_as_string(hide_password=True)


def test_migrations_need_only_database_settings(env) -> None:
    env(DB_HOST="db.internal", DB_PASSWORD="secret-password")
    assert database_url(DatabaseSettings()).host == "db.internal"


def test_auth_defaults(env) -> None:
    env(**REQUIRED)
    settings = Settings()
    assert settings.public_base_url == "https://mdit.example"
    assert (settings.session_days, settings.cookie_secure, settings.dev_login) == (30, True, False)
    assert oauth_credentials(settings, "github") is None
    assert oauth_credentials(settings, "google") is None


def test_public_base_url_loses_trailing_slash(env) -> None:
    env(**{**REQUIRED, "PUBLIC_BASE_URL": "http://localhost:8080/"})
    assert Settings().public_base_url == "http://localhost:8080"


@pytest.mark.parametrize("url", ["localhost:8080", "ftp://mdit.example", ""])
def test_public_base_url_needs_http_scheme(env, url: str) -> None:
    env(**{**REQUIRED, "PUBLIC_BASE_URL": url})
    with pytest.raises(ValidationError):
        Settings()


def test_session_secret_needs_32_characters(env) -> None:
    env(**{**REQUIRED, "SESSION_SECRET": "s" * 31})
    with pytest.raises(ValidationError):
        Settings()


@pytest.mark.parametrize("days", ["0", "366"])
def test_session_days_bounds(env, days: str) -> None:
    env(**REQUIRED, SESSION_DAYS=days)
    with pytest.raises(ValidationError):
        Settings()


def test_dev_login_and_cookie_flags(env) -> None:
    env(**REQUIRED, DEV_LOGIN="1", COOKIE_SECURE="false", SESSION_DAYS="7")
    settings = Settings()
    assert (settings.dev_login, settings.cookie_secure, settings.session_days) == (True, False, 7)


def test_provider_enabled_with_both_values(env) -> None:
    env(**REQUIRED, GITHUB_CLIENT_ID="id", GITHUB_CLIENT_SECRET="sec")
    assert oauth_credentials(Settings(), "github") == ("id", "sec")


def test_half_configured_provider_names_the_missing_variable(env) -> None:
    env(**REQUIRED, GOOGLE_CLIENT_ID="id")
    with pytest.raises(ValidationError, match="GOOGLE_CLIENT_SECRET"):
        Settings()


def test_secret_without_id_names_the_missing_variable(env) -> None:
    env(**REQUIRED, GITHUB_CLIENT_SECRET="sec")
    with pytest.raises(ValidationError, match="GITHUB_CLIENT_ID"):
        Settings()


def test_blank_oauth_values_are_unset(env) -> None:
    # Compose passes unset variables through as empty strings (Review Focus 1).
    env(**REQUIRED, GITHUB_CLIENT_ID="", GITHUB_CLIENT_SECRET="", GOOGLE_CLIENT_ID="")
    settings = Settings()
    assert oauth_credentials(settings, "github") is None
    assert oauth_credentials(settings, "google") is None


def test_auth_secrets_are_hidden(env) -> None:
    env(**REQUIRED, GITHUB_CLIENT_ID="id", GITHUB_CLIENT_SECRET="gh-secret-value")
    text = repr(Settings())
    assert "gh-secret-value" not in text
    assert SESSION_SECRET not in text

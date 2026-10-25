"""Fixtures for integration tests against MySQL and Azurite (P-047)."""

from collections.abc import Iterator

import pytest
from alembic import command
from azure.storage.blob import ContainerClient
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import OperationalError

from app.config import Settings
from app.db.session import create_db_engine
from app.main import create_app
from app.storage.blobs import BlobStore
from tests.support import (
    TEST_BASE_URL,
    alembic_config,
    make_test_settings,
    mysql_unavailable_reason,
    services_unavailable,
)


@pytest.fixture(scope="session")
def test_settings() -> Settings:
    return make_test_settings()


@pytest.fixture(scope="session")
def engine(test_settings: Settings) -> Iterator[Engine]:
    engine = create_db_engine(test_settings)
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except OperationalError as exc:
        engine.dispose()
        services_unavailable(
            mysql_unavailable_reason(exc, test_settings.db_host, test_settings.db_port)
        )
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def migrated(engine: Engine) -> Engine:
    """mdit_test rebuilt once per run: down to base, then up to head."""
    with engine.begin() as connection:
        config = alembic_config(connection)
        command.downgrade(config, "base")
        command.upgrade(config, "head")
    return engine


@pytest.fixture(scope="session")
def blob_store(test_settings: Settings) -> Iterator[BlobStore]:
    connection_string = test_settings.blob_connection_string.get_secret_value()
    store = BlobStore.from_connection_string(connection_string, test_settings.blob_container)
    if not store.ensure_container():
        services_unavailable("Azurite is not reachable at the test blob endpoint")
    yield store
    ContainerClient.from_connection_string(
        connection_string, test_settings.blob_container
    ).delete_container()


# Children before parents, so foreign keys never block the cleanup.
APP_TABLES_CHILD_FIRST = (
    "version_images",
    "versions",
    "documents",
    "projects",
    "sessions",
    "user_blobs",
    "blobs",
    "users",
)


@pytest.fixture
def clean_db(migrated: Engine) -> Engine:
    """API tests start from empty tables (rows, not the schema)."""
    with migrated.begin() as connection:
        for table in APP_TABLES_CHILD_FIRST:
            connection.execute(text(f"DELETE FROM {table}"))
    return migrated


@pytest.fixture
def api_settings(test_settings: Settings) -> Settings:
    return test_settings.model_copy(update={"dev_login": True})


@pytest.fixture
def app(clean_db: Engine, blob_store: BlobStore, api_settings: Settings) -> FastAPI:
    return create_app(api_settings)


def api_client(app: FastAPI, *, csrf: bool = True) -> TestClient:
    """https, so Secure cookies come back; the CSRF header on every request unless told not to."""
    headers = {"X-MdIt-CSRF": "1"} if csrf else {}
    return TestClient(app, base_url=TEST_BASE_URL, headers=headers)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with api_client(app) as client:
        yield client


@pytest.fixture
def other_client(app: FastAPI) -> Iterator[TestClient]:
    """A second browser: its own cookie jar."""
    with api_client(app) as client:
        yield client

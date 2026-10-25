"""Fixtures for integration tests against MySQL and Azurite (P-047)."""

from collections.abc import Iterator

import pytest
from alembic import command
from azure.storage.blob import ContainerClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import OperationalError

from app.config import Settings
from app.db.session import create_db_engine
from app.storage.blobs import BlobStore
from tests.support import (
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

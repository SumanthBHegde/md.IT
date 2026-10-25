"""Alembic environment. Migrations run as their own step, never at app startup (P-051)."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import Connection

from app.config import DatabaseSettings
from app.db import models  # noqa: F401  (registers the tables on Base.metadata)
from app.db.base import Base
from app.db.session import create_db_engine

config = context.config
target_metadata = Base.metadata


def run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:  # tests pass their own connection
        run_migrations(connection)
        return
    if config.config_file_name is not None:
        fileConfig(config.config_file_name, disable_existing_loggers=False)
    # Database credentials only: the migrate step needs no blob or sign-in secrets.
    engine = create_db_engine(DatabaseSettings())  # type: ignore[call-arg]  # values come from env vars
    with engine.connect() as connection:
        run_migrations(connection)
    engine.dispose()


if context.is_offline_mode():
    raise SystemExit("Offline (--sql) migrations are not supported.")
run_migrations_online()

"""Readiness checks (P-050): each answers within a few seconds, never raises, and logs why."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings
from app.db.session import create_db_engine
from app.storage.blobs import BlobStore

log = logging.getLogger(__name__)

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


@dataclass(frozen=True)
class ReadinessChecks:
    database: Callable[[], bool]
    migrations: Callable[[], bool]
    blob: Callable[[], bool]


def _scripts() -> ScriptDirectory:
    return ScriptDirectory.from_config(Config(str(ALEMBIC_INI)))


def head_revision() -> str | None:
    return _scripts().get_current_head()


def known_revisions() -> frozenset[str]:
    return frozenset(script.revision for script in _scripts().walk_revisions())


def revision_is_ready(current: str | None, head: str | None, known: frozenset[str]) -> bool:
    """At head, or at a revision this code doesn't know: a newer deploy migrated ahead
    during a rolling update, and this pod can keep serving until it is replaced."""
    if current is None:
        return False
    return current == head or current not in known


def database_check(engine: Engine) -> Callable[[], bool]:
    def check() -> bool:
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except SQLAlchemyError:
            log.warning("Database is unavailable", exc_info=True)
            return False
        return True

    return check


def migrations_check(engine: Engine, head: str | None, known: frozenset[str]) -> Callable[[], bool]:
    def check() -> bool:
        try:
            with engine.connect() as connection:
                current = connection.execute(
                    text("SELECT version_num FROM alembic_version")
                ).scalar_one_or_none()
        except SQLAlchemyError:
            log.warning("Migration state is unavailable", exc_info=True)
            return False
        if not revision_is_ready(current, head, known):
            log.warning("Database is at revision %s; expected %s", current, head)
            return False
        if current != head:
            log.info("Database is at newer revision %s; this code knows %s", current, head)
        return True

    return check


def readiness_engine(settings: Settings) -> Engine:
    """A separate, small engine whose every step gives up within about two seconds."""
    return create_db_engine(settings, io_timeout=2, pool_size=1, max_overflow=0, pool_timeout=2)


def build_readiness(engine: Engine, blobs: BlobStore) -> ReadinessChecks:
    return ReadinessChecks(
        database=database_check(engine),
        migrations=migrations_check(engine, head_revision(), known_revisions()),
        # Creates the container when missing, so a backend that started before Azurite recovers.
        blob=blobs.ensure_container,
    )

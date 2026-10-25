"""Real readiness checks against services that are down, and logging setup."""

import contextlib
import inspect
import logging
import socket
import threading
import time
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.db.session import create_db_engine
from app.logging import configure_logging
from app.main import create_app
from app.readiness import database_check, known_revisions, migrations_check, revision_is_ready
from app.routes.health import health
from tests.support import fake_settings


def test_database_check_reports_an_unreachable_database(caplog: pytest.LogCaptureFixture) -> None:
    engine = create_db_engine(fake_settings())
    started = time.monotonic()
    assert database_check(engine)() is False
    assert time.monotonic() - started < 5
    assert "Database is unavailable" in caplog.text
    engine.dispose()


@pytest.fixture
def silent_server() -> Iterator[int]:
    """A TCP server that accepts connections and never answers, like a frozen database."""
    listener = socket.create_server(("127.0.0.1", 0))
    accepted: list[socket.socket] = []

    def accept() -> None:
        with contextlib.suppress(OSError):
            while True:
                accepted.append(listener.accept()[0])

    threading.Thread(target=accept, daemon=True).start()
    yield listener.getsockname()[1]
    listener.close()
    for connection in accepted:
        connection.close()


def test_readiness_gives_up_on_a_database_that_never_answers(silent_server: int) -> None:
    client = TestClient(create_app(fake_settings(db_port=silent_server)))
    result: dict[str, int] = {}

    def probe() -> None:
        result["status"] = client.get("/api/health/ready").status_code

    thread = threading.Thread(target=probe, daemon=True)
    thread.start()
    thread.join(timeout=10)
    assert not thread.is_alive(), "readiness hung on a silent database"
    assert result["status"] == 503


def test_liveness_never_waits_for_the_worker_threads() -> None:
    # Blocked readiness checks hold sync worker threads; liveness must not need one.
    assert inspect.iscoroutinefunction(health)


def test_migrations_check_reports_an_unreachable_database() -> None:
    engine = create_db_engine(fake_settings())
    assert migrations_check(engine, "0001", frozenset({"0001"}))() is False
    engine.dispose()


@pytest.fixture
def app_logger() -> Iterator[logging.Logger]:
    logger = logging.getLogger("app")
    handlers, level = logger.handlers[:], logger.level
    yield logger
    logger.handlers[:] = handlers
    logger.setLevel(level)


def test_app_logs_go_to_stdout_at_the_configured_level(
    app_logger: logging.Logger, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging("WARNING")
    logging.getLogger("app.example").info("hidden line")
    logging.getLogger("app.example").warning("shown line")
    out = capsys.readouterr().out
    assert "shown line" in out
    assert "hidden line" not in out


KNOWN = frozenset({"0001", "0002"})


def test_head_revision_is_ready() -> None:
    assert revision_is_ready("0002", "0002", KNOWN) is True


def test_newer_unknown_revision_is_ready() -> None:
    # A newer deploy migrated ahead during a rolling update; old pods stay ready.
    assert revision_is_ready("9999", "0002", KNOWN) is True


def test_older_known_revision_is_not_ready() -> None:
    assert revision_is_ready("0001", "0002", KNOWN) is False


def test_missing_revision_is_not_ready() -> None:
    assert revision_is_ready(None, "0002", KNOWN) is False


def test_known_revisions_lists_every_migration() -> None:
    assert {"0001"} <= known_revisions()

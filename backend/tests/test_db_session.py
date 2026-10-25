"""Engine and per-request sessions."""

from types import SimpleNamespace

import pytest
from sqlalchemy import Engine, text

from app.db.session import create_db_engine, get_session
from tests.support import fake_settings


def test_engine_uses_pymysql_without_connecting() -> None:
    engine = create_db_engine(fake_settings())
    assert engine.url.drivername == "mysql+pymysql"
    assert engine.url.port == 1
    engine.dispose()


def test_engine_hides_parameters() -> None:
    # SQL parameters can carry document paths, messages and token hashes; keep them out of logs.
    engine = create_db_engine(fake_settings())
    assert engine.hide_parameters is True
    engine.dispose()


@pytest.mark.integration
def test_connections_use_utc_and_utf8mb4(engine: Engine) -> None:
    with engine.connect() as connection:
        zone, charset = connection.execute(
            text("SELECT @@session.time_zone, @@character_set_connection")
        ).one()
    assert zone == "+00:00"
    assert charset == "utf8mb4"


@pytest.mark.integration
def test_get_session_yields_a_working_session(engine: Engine) -> None:
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(engine=engine)))
    sessions = get_session(request)  # type: ignore[arg-type]
    session = next(sessions)
    assert session.execute(text("SELECT 1")).scalar_one() == 1
    sessions.close()

"""Integration tests skip locally but fail in CI when services are down (P-047)."""

import pymysql
import pytest
from sqlalchemy.exc import OperationalError

from tests.support import START_HINT, mysql_unavailable_reason, services_unavailable


def test_services_unavailable_skips_or_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MDIT_REQUIRE_SERVICES", raising=False)
    with pytest.raises(pytest.skip.Exception, match=START_HINT):
        services_unavailable("MySQL is not reachable")

    monkeypatch.setenv("MDIT_REQUIRE_SERVICES", "1")
    with pytest.raises(pytest.fail.Exception, match="MySQL is not reachable"):
        services_unavailable("MySQL is not reachable")


def operational_error(code: int, message: str) -> OperationalError:
    return OperationalError("connect", {}, pymysql.err.OperationalError(code, message))


def test_unreachable_mysql_reason() -> None:
    reason = mysql_unavailable_reason(operational_error(2003, "Can't connect"), "h", 1)
    assert reason == "MySQL is not reachable at h:1"


def test_refused_mysql_reason_names_the_error() -> None:
    reason = mysql_unavailable_reason(operational_error(1045, "Access denied"), "h", 1)
    assert reason == "MySQL at h:1 refused the test connection (error 1045)"

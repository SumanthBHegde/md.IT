"""Access logs never carry OAuth codes, state or the login `next` (spec 5a 7.2)."""

import logging

from app.logging import RedactAuthQuery, configure_logging

FORMAT = '%s - "%s %s HTTP/%s" %d'


def access_record(path: str) -> logging.LogRecord:
    return logging.LogRecord(
        "uvicorn.access", logging.INFO, "", 0, FORMAT, ("1.2.3.4:5", "GET", path, "1.1", 302), None
    )


def test_callback_query_is_redacted() -> None:
    record = access_record("/api/auth/callback/github?code=SECRET&state=S")
    assert RedactAuthQuery().filter(record) is True
    message = record.getMessage()
    assert "SECRET" not in message
    assert "/api/auth/callback/github?…" in message


def test_login_query_is_redacted() -> None:
    record = access_record("/api/auth/login/dev?name=alice&next=/p/1")
    RedactAuthQuery().filter(record)
    assert "alice" not in record.getMessage()


def test_other_paths_are_untouched() -> None:
    record = access_record("/api/projects?x=1")
    RedactAuthQuery().filter(record)
    assert "/api/projects?x=1" in record.getMessage()


def test_paths_without_query_are_untouched() -> None:
    record = access_record("/api/auth/callback/github")
    RedactAuthQuery().filter(record)
    assert '"GET /api/auth/callback/github HTTP/1.1"' in record.getMessage()


def test_filter_added_once() -> None:
    configure_logging("INFO")
    configure_logging("INFO")
    access = logging.getLogger("uvicorn.access")
    assert sum(isinstance(f, RedactAuthQuery) for f in access.filters) == 1

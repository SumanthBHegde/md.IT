"""Application logs go to stdout (PRD 12: never bodies, headers, cookies or secrets)."""

import logging
import sys

FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


REDACTED_PREFIXES = ("/api/auth/callback/", "/api/auth/login/")


class RedactAuthQuery(logging.Filter):
    """Drops the query string of sign-in URLs from Uvicorn's access log: it carries OAuth
    codes and state, dev login names and the `next` path."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str):
            path = args[2]
            if path.startswith(REDACTED_PREFIXES) and "?" in path:
                record.args = (*args[:2], path.split("?", 1)[0] + "?…", *args[3:])
        return True


def configure_logging(level: str) -> None:
    """Configure the `app` logger tree; Uvicorn keeps its own access and error logs."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(FORMAT))
    logger = logging.getLogger("app")
    logger.handlers[:] = [handler]
    logger.setLevel(level)
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, RedactAuthQuery) for f in access.filters):
        access.addFilter(RedactAuthQuery())

"""Every route is guarded: no session → 401, no CSRF header → 403 (P-067).

These walk every operation in the OpenAPI schema, so a route added later can't skip either
check. (FastAPI 0.142 nests included routers in a private type, so app.routes isn't flat; the
schema is the public list of routes. No route opts out with include_in_schema=False.)
"""

import re
import uuid

import pytest
from fastapi import FastAPI
from sqlalchemy import Engine

from app.csrf import MUTATING
from tests.conftest import api_client
from tests.support import sign_in

pytestmark = pytest.mark.integration

PUBLIC = {
    ("GET", "/api/health"),
    ("GET", "/api/health/ready"),
    ("GET", "/api/auth/providers"),
    ("GET", "/api/auth/login/{provider}"),
    ("GET", "/api/auth/callback/{provider}"),
    ("POST", "/api/auth/logout"),
}
PARAM = re.compile(r"\{(\w+)\}")


def api_routes(app: FastAPI) -> list[tuple[str, str]]:
    return sorted(
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
    )


def fill(path: str) -> str:
    return PARAM.sub(lambda m: "0" * 64 if m.group(1) == "hash" else str(uuid.uuid4()), path)


def test_guard_sees_the_routes(app: FastAPI) -> None:
    routes = api_routes(app)
    assert ("GET", "/api/me") in routes
    assert ("POST", "/api/auth/logout") in routes


def test_every_private_route_needs_a_session(app: FastAPI) -> None:
    client = api_client(app)
    failures = []
    for method, path in api_routes(app):
        if (method, path) in PUBLIC:
            continue
        response = client.request(method, fill(path))
        code = response.json()["error"]["code"] if method != "HEAD" else None
        if response.status_code != 401 or code not in ("unauthenticated", None):
            failures.append((method, path, response.status_code))
    assert failures == []


@pytest.mark.parametrize("signed_in", [False, True])
def test_every_mutating_route_needs_the_csrf_header(
    app: FastAPI, clean_db: Engine, signed_in: bool
) -> None:
    client = api_client(app, csrf=False)
    if signed_in:
        sign_in(client, clean_db)
    failures = []
    for method, path in api_routes(app):
        if method not in MUTATING:
            continue
        response = client.request(method, fill(path))
        if response.status_code != 403 or response.json()["error"]["code"] != "csrf":
            failures.append((method, path, response.status_code))
    assert failures == []

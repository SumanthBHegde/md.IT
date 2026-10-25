"""CSRF (P-064): every mutating /api request carries X-MdIt-CSRF: 1.

Browsers can't add a custom header to a cross-origin request without a CORS preflight, and
the API never answers one. A pure ASGI middleware, so it runs before routing (unknown routes
too) and request bodies still stream.
"""

from starlette.types import ASGIApp, Receive, Scope, Send

from app.errors import error_response

CSRF_HEADER = b"x-mdit-csrf"
MUTATING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class CsrfMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope["method"] in MUTATING
            and scope["path"].startswith("/api/")
            and dict(scope["headers"]).get(CSRF_HEADER) != b"1"
        ):
            response = error_response(403, "csrf", "This request is missing its CSRF header.")
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)

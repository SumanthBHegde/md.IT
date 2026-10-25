"""One error shape for every failure: {"error": {"code", "message"}} (P-052)."""

from collections.abc import Mapping
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

_CODES = {404: "not_found", 405: "method_not_allowed"}


class ApiError(Exception):
    """An expected failure with its own code; becomes the standard error body."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: Any = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details
        self.headers = dict(headers or {})


def error_response(status: int, code: str, message: str, details: Any = None) -> JSONResponse:
    error: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return JSONResponse({"error": error}, status_code=status)


def _message(status: int, detail: object) -> str:
    try:
        phrase = HTTPStatus(status).phrase
    except ValueError:  # a status code outside the standard list
        return "Error."
    if isinstance(detail, str) and detail and detail != phrase:
        return detail
    return phrase.capitalize() + "."


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        status = exc.status_code
        response = error_response(
            status, _CODES.get(status, f"http_{status}"), _message(status, exc.detail)
        )
        if exc.headers:
            response.headers.update(exc.headers)
        return response

    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError) -> JSONResponse:
        response = error_response(exc.status, exc.code, exc.message, exc.details)
        response.headers.update(exc.headers)
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"field": ".".join(str(part) for part in err["loc"]), "message": str(err["msg"])}
            for err in exc.errors()
        ]
        return error_response(422, "invalid_request", "The request is not valid.", details)

    @app.exception_handler(Exception)
    async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
        # Starlette re-raises after this response is sent, so Uvicorn logs the traceback.
        return error_response(500, "internal_error", "Something went wrong.")

"""Health endpoints (P-050). Both are public."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.readiness import ReadinessChecks

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("", operation_id="getHealth")
async def health() -> dict[str, str]:
    """Liveness: the process answers. Never touches the database or Blob Storage.

    Async, so it runs on the event loop and never waits for a worker thread that a hung
    readiness check may be holding.
    """
    return {"status": "ok"}


@router.get(
    "/ready",
    operation_id="getReadiness",
    responses={503: {"description": "A dependency is unavailable"}},
)
def ready(request: Request) -> JSONResponse:
    """Readiness: database, migrations at head, blob container. Details stay in the logs."""
    checks: ReadinessChecks = request.app.state.readiness
    database = checks.database()
    results = {
        "database": database,
        # Skipped when the database is down: each failed attempt can take seconds (DNS).
        "migrations": database and checks.migrations(),
        "blob": checks.blob(),
    }
    ok = all(results.values())
    body = {
        "status": "ok" if ok else "unavailable",
        "checks": {name: "ok" if passed else "unavailable" for name, passed in results.items()},
    }
    return JSONResponse(body, status_code=200 if ok else 503)

"""Sign-in and sign-out (spec 5a section 5.1)."""

from fastapi import APIRouter, Request, Response

from app.auth import SESSION_COOKIE, clear_session_cookie
from app.db.session import DbSession
from app.schemas.common import error_responses
from app.services.sessions import end_session

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/logout", operation_id="logout", status_code=204, responses=error_responses(403))
def logout(request: Request, db: DbSession) -> Response:
    """Ends this browser's session; fine without one."""
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        end_session(db, token)
    response = Response(status_code=204)
    clear_session_cookie(response, request.app.state.settings)
    return response

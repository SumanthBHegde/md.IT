"""The signed-in account (PRD 6.1)."""

from fastapi import APIRouter, Request, Response

from app.auth import CurrentUser, clear_session_cookie
from app.db.session import DbSession
from app.schemas.common import error_responses
from app.schemas.me import MeOut
from app.services.accounts import delete_account

router = APIRouter(prefix="/api/me", tags=["account"])


@router.get("", operation_id="getMe", response_model=MeOut, responses=error_responses(401))
def get_me(user: CurrentUser) -> MeOut:
    return MeOut(
        id=user.public_id, provider=user.provider, email=user.email, created_at=user.created_at
    )


@router.delete(
    "", operation_id="deleteAccount", status_code=204, responses=error_responses(401, 403)
)
def delete_me(request: Request, user: CurrentUser, db: DbSession) -> Response:
    """Removes the account, every version and every blob nobody else owns."""
    delete_account(db, request.app.state.blobs, user)
    response = Response(status_code=204)
    clear_session_cookie(response, request.app.state.settings)
    return response

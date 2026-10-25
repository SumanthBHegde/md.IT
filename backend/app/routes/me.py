"""The signed-in account (PRD 6.1)."""

from fastapi import APIRouter

from app.auth import CurrentUser
from app.schemas.common import error_responses
from app.schemas.me import MeOut

router = APIRouter(prefix="/api/me", tags=["account"])


@router.get("", operation_id="getMe", response_model=MeOut, responses=error_responses(401))
def get_me(user: CurrentUser) -> MeOut:
    return MeOut(
        id=user.public_id, provider=user.provider, email=user.email, created_at=user.created_at
    )

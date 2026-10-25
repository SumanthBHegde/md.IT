"""Sign-in and sign-out (spec 5a section 5.1).

The OAuth state, PKCE verifier and `next` live in the short-lived `mdit_oauth` cookie
(SessionMiddleware). Callback failures redirect to `/?login_error=<code>`: the callback is a
browser navigation, so JSON would be no use there.
"""

import logging
import re
import secrets
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import RedirectResponse

from app.auth import SESSION_COOKIE, clear_session_cookie, safe_next, set_session_cookie
from app.config import Settings
from app.db.models import User
from app.db.session import DbSession
from app.errors import ApiError
from app.schemas.auth import ProvidersOut
from app.schemas.common import error_responses
from app.services.accounts import upsert_user
from app.services.oauth import Identity, IdentityProvider, ProviderError
from app.services.sessions import create_session, end_session

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

DEV = "dev"
DEV_NAME = re.compile(r"[a-z0-9_-]{1,64}")
STATE_KEY = "oauth"
REDIRECT_RESPONSES: dict[int | str, dict[str, object]] = {
    302: {"description": "Redirect to the provider, or back into the app"}
}

NextParam = Annotated[str | None, Query(alias="next", max_length=4096)]


def _providers(request: Request) -> dict[str, IdentityProvider]:
    providers: dict[str, IdentityProvider] = request.app.state.providers
    return providers


def _settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def redirect_uri(settings: Settings, provider: str) -> str:
    return f"{settings.public_base_url}/api/auth/callback/{provider}"


def _signed_in(request: Request, db: DbSession, identity: Identity, target: str) -> Response:
    user: User = upsert_user(db, identity)
    settings = _settings(request)
    token = create_session(db, user, settings.session_days)
    response = RedirectResponse(target, status_code=302)
    set_session_cookie(response, token, settings)
    return response


def _not_found() -> ApiError:
    return ApiError(404, "not_found", "Not found.")


@router.get("/providers", operation_id="listProviders", response_model=ProvidersOut)
def list_providers(request: Request) -> ProvidersOut:
    names = list(_providers(request))
    if _settings(request).dev_login:
        names.append(DEV)
    return ProvidersOut(providers=names)


@router.get(
    "/login/{provider}",
    operation_id="startLogin",
    status_code=302,
    response_class=RedirectResponse,
    responses={**REDIRECT_RESPONSES, **error_responses(404, 422)},
)
def start_login(
    provider: str,
    request: Request,
    db: DbSession,
    next_: NextParam = None,
    name: Annotated[str | None, Query(max_length=256)] = None,
) -> Response:
    target = safe_next(next_)
    if provider == DEV and _settings(request).dev_login:
        if name is None or not DEV_NAME.fullmatch(name):
            raise ApiError(
                422, "invalid_request", "Dev login needs a name of a–z, 0–9, _ or - (1–64)."
            )
        return _signed_in(request, db, Identity(DEV, name, None), target)
    impl = _providers(request).get(provider)
    if impl is None:
        raise _not_found()
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    request.session[STATE_KEY] = {
        "provider": provider,
        "state": state,
        "verifier": verifier,
        "next": target,
    }
    url = impl.authorization_url(redirect_uri(_settings(request), provider), state, verifier)
    return RedirectResponse(url, status_code=302)


@router.get(
    "/callback/{provider}",
    operation_id="finishLogin",
    status_code=302,
    response_class=RedirectResponse,
    responses={**REDIRECT_RESPONSES, **error_responses(404)},
)
def finish_login(
    provider: str,
    request: Request,
    db: DbSession,
    code: Annotated[str | None, Query(max_length=2048)] = None,
    state: Annotated[str | None, Query(max_length=256)] = None,
    error: Annotated[str | None, Query(max_length=256)] = None,
) -> Response:
    impl = _providers(request).get(provider)
    if impl is None:
        raise _not_found()
    saved = request.session.pop(STATE_KEY, None)  # single use
    request.session.clear()

    def failed(kind: str) -> Response:
        log.warning("Sign-in failed: %s (%s)", kind, provider)
        return RedirectResponse(f"/?login_error={kind}", status_code=302)

    if error == "access_denied":
        return failed("denied")
    if error:
        return failed("provider")
    if (
        not isinstance(saved, dict)
        or saved.get("provider") != provider
        or not state
        or not secrets.compare_digest(str(saved.get("state", "")), state)
    ):
        return failed("state")
    if not code:
        return failed("provider")
    try:
        identity = impl.fetch_identity(
            redirect_uri(_settings(request), provider), code, str(saved["verifier"])
        )
    except ProviderError:
        return failed("provider")
    return _signed_in(request, db, identity, safe_next(saved.get("next")))


@router.post("/logout", operation_id="logout", status_code=204, responses=error_responses(403))
def logout(request: Request, db: DbSession) -> Response:
    """Ends this browser's session; fine without one."""
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        end_session(db, token)
    response = Response(status_code=204)
    clear_session_cookie(response, _settings(request))
    return response

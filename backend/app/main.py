"""md.IT API. Uvicorn builds it with `--factory app.main:create_app`, so importing this
module never reads the environment."""

import logging
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from starlette.middleware.sessions import SessionMiddleware

from app.config import Settings
from app.csrf import CsrfMiddleware
from app.db.session import create_db_engine
from app.errors import install_error_handlers
from app.logging import configure_logging
from app.readiness import ReadinessChecks, build_readiness, readiness_engine
from app.routes import auth, documents, health, me, projects, versions
from app.routes import blobs as blob_routes
from app.services.oauth import IdentityProvider, build_providers
from app.storage.blobs import BlobStore

log = logging.getLogger(__name__)

# The OAuth state cookie: state, PKCE verifier and `next` for one sign-in in progress.
OAUTH_COOKIE = "mdit_oauth"
OAUTH_COOKIE_SECONDS = 600


def create_app(
    settings: Settings | None = None,
    readiness: ReadinessChecks | None = None,
    providers: Mapping[str, IdentityProvider] | None = None,
) -> FastAPI:
    settings = settings or Settings()  # type: ignore[call-arg]  # values come from env vars
    configure_logging(settings.log_level)
    if settings.dev_login:
        log.warning(
            "DEV_LOGIN is on: anyone can sign in as any dev user. "
            "Never enable it outside local development."
        )
    engine = create_db_engine(settings)
    probe_engine = readiness_engine(settings)
    blobs = BlobStore.from_connection_string(
        settings.blob_connection_string.get_secret_value(), settings.blob_container
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Never raises; if Azurite isn't up yet, readiness creates the container later.
        await run_in_threadpool(blobs.ensure_container)
        yield
        engine.dispose()
        probe_engine.dispose()

    app = FastAPI(
        title="md.IT API",
        version="0.1.0",
        lifespan=lifespan,
        openapi_url="/api/openapi.json",
        docs_url="/api/docs",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.providers = dict(providers) if providers is not None else build_providers(settings)
    app.state.engine = engine
    app.state.blobs = blobs
    app.state.readiness = readiness or build_readiness(probe_engine, blobs)
    install_error_handlers(app)
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret.get_secret_value(),
        session_cookie=OAUTH_COOKIE,
        max_age=OAUTH_COOKIE_SECONDS,
        path="/api/auth",
        same_site="lax",
        https_only=settings.cookie_secure,
    )
    app.add_middleware(CsrfMiddleware)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(me.router)
    app.include_router(projects.router)
    app.include_router(documents.router)
    app.include_router(versions.router)
    app.include_router(blob_routes.router)
    return app

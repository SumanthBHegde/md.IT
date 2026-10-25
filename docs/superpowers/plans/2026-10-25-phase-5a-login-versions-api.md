# Phase 5a — Login and versions API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The md.IT backend gains sign-in (GitHub, Google, dev), server-side sessions, CSRF protection, and a projects / documents / versions / blobs API with conflict detection, per-user blob ownership and account deletion.

**Architecture:** FastAPI routes stay thin; `app/services/` holds the rules (sessions, OAuth, blobs, versions, accounts) and returns DTOs from `app/schemas/`; one SQLAlchemy session per request. CSRF is a pure ASGI middleware in front of routing; authentication is a `current_user` dependency. Migration `0002` adds `sessions`, `user_blobs`, `version_images` and `documents.next_number`.

**Tech Stack:** Python 3.14, FastAPI 0.142, SQLAlchemy 2.0.54 + PyMySQL, Alembic 1.20, Authlib 1.8.0 (sync `OAuth2Client` on httpx2), Starlette `SessionMiddleware` (itsdangerous 2.2), defusedxml 0.7.1, azure-storage-blob 12.31, pytest 9.1 on MySQL 8.4 + Azurite 3.37.

**Spec:** `docs/superpowers/specs/2026-10-25-phase-5a-login-versions-api-design.md` (read it; this plan argues from it).

## Global Constraints

- Commands run from `backend/` with `python -m uv run …` (uv is not on PATH on the dev machine); services: `docker compose up -d --wait mysql azurite` from the repo root.
- Every task ends with `python -m uv run ruff check .`, `python -m uv run ruff format --check .`, `python -m uv run mypy app` clean and the full `python -m uv run pytest` passing (with services up).
- Every error body is `{"error": {"code", "message", "details"?}}` (P-052); new codes exactly: `unauthenticated`, `csrf`, `version_conflict`, `blob_missing`, `hash_mismatch`, `unsupported_type`, `too_large`.
- IDs in the API are `public_id` UUID4 strings; timestamps serialize as ISO 8601 UTC with `Z`.
- Another user's resource is 404 `not_found`, never 403.
- Cookies: `mdit_session` (HttpOnly, Secure unless `COOKIE_SECURE=false`, SameSite=Lax, Path `/api`, Max-Age `SESSION_DAYS × 86400`); `mdit_oauth` (SessionMiddleware, max_age 600, path `/api/auth`, same_site lax, https_only = `COOKIE_SECURE`).
- CSRF header: `X-MdIt-CSRF: 1` on every POST/PUT/PATCH/DELETE under `/api`.
- Blob limit 5 × 1024 × 1024 bytes; allowed types `text/markdown`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`.
- Limits: message ≤ 500 chars, ≤ 500 images per version, project name 1–255 chars (trimmed), path ≤ 1024 chars, dev login name `^[a-z0-9_-]{1,64}$`, `next` ≤ 2048 chars, `SESSION_SECRET` ≥ 32 chars, `SESSION_DAYS` 1–365.
- Never log session tokens, cookies, OAuth codes/tokens or document content.
- Every route has an explicit `operation_id` (camelCase) and `response_model` (or `status_code=204`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; update `context.md` (log line) in the same commit or a `docs:` commit right after (CLAUDE.md).

## Review Focus

1. **Compose passes empty strings for unset OAuth variables** (`GITHUB_CLIENT_ID=`): must count as unset, not as a half-configured provider → Task 1 `test_blank_oauth_values_are_unset`.
2. **Callback opened without the state cookie** (it expired after 10 minutes, or the link was opened in another browser): must redirect to `/?login_error=state`, not 500 → Task 6 `test_callback_without_state_cookie`.
3. **`Content-Type: text/markdown; charset=utf-8`** (what browsers and `fetch` commonly send): must be accepted as `text/markdown` → Task 7 `test_content_type_parameters_are_ignored`.
4. **Image paths that differ only in case** (`images/A.png` and `images/a.png` in one save): must be 422, because the local store treats them as the same name (P-008) → Task 9 `test_duplicate_image_paths_ignore_case`.
5. **GitHub account whose `/user/emails` call fails** (scope not granted, 403/404): sign-in must still succeed with `email = null` → Task 5 `test_github_email_lookup_failure_gives_null_email`.

---

## File map

```
backend/
  pyproject.toml                      deps (Task 1)
  app/
    config.py                         auth settings (Task 1)
    errors.py                         ApiError, non-standard statuses (Task 2)
    readiness.py                      newer revision ready (Task 2)
    db/session.py                     hide_parameters, DbSession alias (Task 2)
    db/models.py                      LoginSession, UserBlob, VersionImage, next_number (Task 3)
    storage/blobs.py                  is_blob_hash, delete (Task 7)
    csrf.py                           CsrfMiddleware (Task 4)
    auth.py                           current_user, cookie helpers, safe_next (Tasks 4, 6)
    logging.py                        RedactAuthQuery filter (Task 6)
    main.py                           middleware, routers, providers (Tasks 4–10)
    schemas/common.py                 UtcDateTime, ErrorOut, error_responses (Task 4)
    schemas/me.py  auth.py            (Tasks 4, 6)
    schemas/paths.py                  path rule (Task 8)
    schemas/projects.py documents.py versions.py   (Tasks 8, 9)
    services/sessions.py              (Task 4)
    services/accounts.py              upsert_user (Task 4), delete_account (Task 10)
    services/oauth.py                 (Task 5)
    services/blobs.py                 (Task 7)
    services/projects.py              lookups scoped to the user (Task 8)
    services/versions.py              (Task 9)
    routes/me.py auth.py blobs.py projects.py documents.py versions.py
  alembic/versions/0002_sessions_ownership_version_images.py   (Task 3)
  tests/support.py conftest.py        fixtures (Tasks 1, 2, 4)
  tests/test_*.py                     per task
scripts/api_smoke.py                  (Task 11)
docker-compose.yml .env.example gateway/default.conf .github/workflows/ci.yml README.md  (Task 11)
```

---

### Task 1: Dependencies and auth settings

**Files:**
- Modify: `backend/pyproject.toml`, `backend/uv.lock` (via uv)
- Modify: `backend/app/config.py`
- Modify: `backend/tests/support.py` (`make_test_settings`, `fake_settings`)
- Test: `backend/tests/test_config.py`

**Interfaces:**
- Produces: `Settings` fields `public_base_url: str`, `session_secret: SecretStr`, `session_days: int = 30`, `cookie_secure: bool = True`, `github_client_id: str | None`, `github_client_secret: SecretStr | None`, `google_client_id: str | None`, `google_client_secret: SecretStr | None`, `dev_login: bool = False`; `oauth_credentials(settings: Settings, name: Literal["github", "google"]) -> tuple[str, str] | None`.
- Produces: `make_test_settings()` and `fake_settings()` set `public_base_url="https://testserver"` and `session_secret=SecretStr("test-session-secret-" + "x" * 16)`.

- [ ] **Step 1: Dependencies.** In `backend/`: `python -m uv add "authlib>=1.8,<1.9" "httpx2>=2.13,<2.14" "defusedxml>=0.7.1,<0.8" "itsdangerous>=2.2,<2.3"` then `python -m uv remove --dev httpx2`. Add to `pyproject.toml`:

```toml
[[tool.mypy.overrides]]
module = ["authlib.*", "defusedxml.*"]
ignore_missing_imports = true
```

Check: `python -m uv run python -c "import importlib.util as u; print(u.find_spec('httpx'))"` prints `None` (plain httpx must not be installed, P-068).

- [ ] **Step 2: Write the failing tests** in `tests/test_config.py` (extend `NAMES` with the nine new variables; `REQUIRED` gains `PUBLIC_BASE_URL="https://mdit.example"` and `SESSION_SECRET="s" * 32`):

```python
def test_auth_defaults(env) -> None:
    env(**REQUIRED)
    s = Settings()
    assert (s.session_days, s.cookie_secure, s.dev_login) == (30, True, False)
    assert oauth_credentials(s, "github") is None and oauth_credentials(s, "google") is None

def test_public_base_url_loses_trailing_slash(env) -> None:
    env(**{**REQUIRED, "PUBLIC_BASE_URL": "http://localhost:8080/"})
    assert Settings().public_base_url == "http://localhost:8080"

@pytest.mark.parametrize("url", ["localhost:8080", "ftp://x", ""])
def test_public_base_url_needs_http_scheme(env, url) -> None: ...  # ValidationError

def test_session_secret_needs_32_characters(env) -> None: ...  # "s" * 31 -> ValidationError

@pytest.mark.parametrize("days", ["0", "366"])
def test_session_days_bounds(env, days) -> None: ...  # ValidationError

def test_provider_enabled_with_both_values(env) -> None:
    env(**REQUIRED, GITHUB_CLIENT_ID="id", GITHUB_CLIENT_SECRET="sec")
    assert oauth_credentials(Settings(), "github") == ("id", "sec")

def test_half_configured_provider_names_the_missing_variable(env) -> None:
    env(**REQUIRED, GOOGLE_CLIENT_ID="id")
    with pytest.raises(ValidationError, match="GOOGLE_CLIENT_SECRET"):
        Settings()

def test_blank_oauth_values_are_unset(env) -> None:       # Review Focus 1
    env(**REQUIRED, GITHUB_CLIENT_ID="", GITHUB_CLIENT_SECRET="")
    assert oauth_credentials(Settings(), "github") is None

def test_auth_secrets_are_hidden(env) -> None:
    env(**REQUIRED, GITHUB_CLIENT_ID="id", GITHUB_CLIENT_SECRET="gh-secret-value")
    text = repr(Settings())
    assert "gh-secret-value" not in text and "s" * 32 not in text
```

The existing missing-variable tests keep passing once `REQUIRED` has the two new entries.

- [ ] **Step 3: Run** `python -m uv run pytest tests/test_config.py -v` → new tests FAIL (`ImportError: oauth_credentials`).

- [ ] **Step 4: Implement** in `app/config.py`: the fields above (`session_days: int = Field(30, ge=1, le=365)`); a `mode="before"` validator turning `""` into `None` for the four OAuth fields; a `public_base_url` validator (must start with `http://` or `https://`, then `rstrip("/")`); a `session_secret` validator (≥ 32 characters); a `model_validator(mode="after")` raising `ValueError(f"{NAME}_CLIENT_SECRET is missing")` / `…_CLIENT_ID is missing` when exactly one of a pair is set; `oauth_credentials`. Update `tests/support.py` so both settings builders pass the two new required values.

- [ ] **Step 5: Run** the full suite → PASS (Phase 4 tests still build settings).

- [ ] **Step 6: Commit** `feat(backend): auth settings and Phase 5a dependencies` (+ `context.md` log line).

---

### Task 2: Phase 4 leftovers in the backend

**Files:**
- Modify: `backend/app/errors.py`, `backend/app/readiness.py`, `backend/app/db/session.py`
- Modify: `backend/tests/support.py`, `backend/tests/conftest.py`, `backend/tests/test_migrations.py`
- Test: `backend/tests/test_errors.py`, `backend/tests/test_readiness.py`, `backend/tests/test_support.py`, `backend/tests/test_db_session.py`

**Interfaces:**
- Produces: `class ApiError(Exception)` with `__init__(self, status: int, code: str, message: str, details: Any = None, headers: Mapping[str, str] | None = None)`; handled by `install_error_handlers` into the standard shape. `error_response(status, code, message, details: Any = None)` (details widened to `Any`).
- Produces: `known_revisions() -> frozenset[str]`; `revision_is_ready(current: str | None, head: str | None, known: frozenset[str]) -> bool`; `migrations_check(engine: Engine, head: str | None, known: frozenset[str]) -> Callable[[], bool]`.
- Produces: `DbSession = Annotated[Session, Depends(get_session)]` in `app/db/session.py`.
- Produces: `mysql_unavailable_reason(exc: OperationalError, host: str, port: int) -> str` in `tests/support.py`.

- [ ] **Step 1: Write the failing tests:**

```python
# test_errors.py
def test_api_error_uses_the_error_shape() -> None:
    # route raising ApiError(409, "version_conflict", "Newer version.", {"latest": None}, {"X-A": "1"})
    assert r.status_code == 409 and r.headers["x-a"] == "1"
    assert r.json() == {"error": {"code": "version_conflict", "message": "Newer version.", "details": {"latest": None}}}

def test_non_standard_status_code_does_not_raise() -> None:
    # route raising HTTPException(status_code=599)
    assert r.status_code == 599 and r.json()["error"] == {"code": "http_599", "message": "Error."}

# test_readiness.py — the rule is a pure helper; migrations_check calls it
KNOWN = frozenset({"0001", "0002"})
def test_head_revision_is_ready() -> None:
    assert revision_is_ready("0002", "0002", KNOWN) is True
def test_newer_unknown_revision_is_ready() -> None:
    assert revision_is_ready("9999", "0002", KNOWN) is True
def test_older_known_revision_is_not_ready() -> None:
    assert revision_is_ready("0001", "0002", KNOWN) is False
def test_missing_revision_is_not_ready() -> None:
    assert revision_is_ready(None, "0002", KNOWN) is False
def test_known_revisions_lists_every_migration() -> None:
    assert {"0001"} <= known_revisions()

# test_support.py
def test_unreachable_mysql_reason() -> None:
    exc = OperationalError("connect", {}, pymysql.err.OperationalError(2003, "Can't connect"))
    assert mysql_unavailable_reason(exc, "h", 1) == "MySQL is not reachable at h:1"
def test_refused_mysql_reason_names_the_error() -> None:
    exc = OperationalError("connect", {}, pymysql.err.OperationalError(1045, "Access denied"))
    assert mysql_unavailable_reason(exc, "h", 1) == "MySQL at h:1 refused the test connection (error 1045)"

# test_db_session.py
def test_engine_hides_parameters() -> None:
    assert create_db_engine(fake_settings()).hide_parameters is True
```

`revision_is_ready(current: str | None, head: str | None, known: frozenset[str]) -> bool` lives in `app/readiness.py`; `migrations_check` reads the revision and calls it.

- [ ] **Step 2: Run** those test files → FAIL.

- [ ] **Step 3: Implement.**
  - `errors.py`: `ApiError` plus its handler. `_message` falls back to `"Error."` when `HTTPStatus(status)` raises `ValueError`.
  - `readiness.py`: `known_revisions()` from `ScriptDirectory.walk_revisions()`. The rule: ready if `current == head`, or if `current` is not None and not in `known`. The newer-revision case logs at INFO. `build_readiness` passes `known_revisions()`.
  - `session.py`: `hide_parameters=True` and the `DbSession` alias.
  - `conftest.py`: the `engine` fixture uses `mysql_unavailable_reason`. The reason function treats codes 2003, 2005 and 2013 as "not reachable", and reads the code from `exc.orig.args[0]`.
  - `test_migrations.py`: `test_downgrade_then_upgrade_again` upgrades to head in a `finally`.

- [ ] **Step 4: Run** the full suite → PASS.

- [ ] **Step 5: Commit** `fix(backend): readiness accepts newer revisions, ApiError, hidden SQL parameters, clearer test skips`.

---

### Task 3: Models and migration 0002

**Files:**
- Modify: `backend/app/db/models.py`
- Create: `backend/alembic/versions/0002_sessions_ownership_version_images.py`
- Test: `backend/tests/test_migrations.py`, `backend/tests/test_schema.py`

**Interfaces:**
- Produces models (table names as in spec §4):
  - `LoginSession` (`sessions`): `id`, `token_hash: str` CHAR(64) unique, `user_id` FK users CASCADE, `created_at`, `expires_at: datetime` DATETIME(6). Named `LoginSession` because SQLAlchemy owns `Session`.
  - `UserBlob` (`user_blobs`): PK `(user_id, hash)`, FK users CASCADE, FK blobs RESTRICT, `index=True` on `hash`, `created_at`.
  - `VersionImage` (`version_images`): `id`, `version_id` FK versions CASCADE, `path` String(1024), `hash` FK blobs RESTRICT.
  - `Document.next_number: Mapped[int]` with `Integer`, `server_default=text("1")`.
  - `User` CHECK `provider IN ('github', 'google', 'dev')`.
- Produces: migration revision `"0002"`, `down_revision = "0001"`.

- [ ] **Step 1: Write the failing tests:**
  - `APP_TABLES` gains `sessions`, `user_blobs` and `version_images`.
  - `test_downgrade_to_0001_and_back`: downgrade to `"0001"`; the three tables are gone and `documents` has no `next_number`. Then upgrade back in a `finally`.
  - Schema rules in `test_schema.py`, following the existing style:
    - `test_dev_provider_allowed`
    - `test_unknown_provider_rejected` (OperationalError 3819)
    - `test_session_token_hash_unique`
    - `test_deleting_user_cascades_sessions_and_ownership`
    - `test_blob_with_owner_cannot_be_deleted` (IntegrityError)
    - `test_blob_used_by_version_image_cannot_be_deleted`
    - `test_deleting_version_cascades_its_images`
    - `test_next_number_defaults_to_1`

- [ ] **Step 2: Run** `python -m uv run pytest tests/test_migrations.py tests/test_schema.py -v` → FAIL.

- [ ] **Step 3: Implement** the models.
  - Autogenerate with `python -m uv run alembic revision --autogenerate -m "sessions ownership version images" --rev-id 0002` against the Compose `mdit` database at 0001.
  - Then edit by hand as 0001 was: explicit `TABLE_OPTIONS`, `created_at()` helper, constraint names. The CHECK change is `op.drop_constraint("ck_users_provider", "users", type_="check")` then `op.create_check_constraint("provider", "users", "provider IN ('github', 'google', 'dev')")`.
  - `downgrade()` reverses it in order. Restoring the old CHECK fails if any `dev` users exist; this is acceptable, so note it in a comment.
  - Rename the file to `0002_sessions_ownership_version_images.py`.

- [ ] **Step 4: Run** the full suite → PASS, including `test_models_match_the_migrations`. Then `python -m uv run alembic upgrade head` against Compose `mdit`.

- [ ] **Step 5: Commit** `feat(backend): migration 0002 — sessions, blob ownership, version images, version counter`.

---

### Task 4: Sessions, CSRF, current user, `/api/me`, logout

**Files:**
- Create: `backend/app/services/__init__.py`, `services/sessions.py`, `services/accounts.py`, `app/auth.py`, `app/csrf.py`, `app/schemas/__init__.py`, `schemas/common.py`, `schemas/me.py`, `routes/me.py`, `routes/auth.py` (logout only for now)
- Modify: `backend/app/main.py`, `backend/tests/conftest.py`, `backend/tests/support.py`
- Test: `backend/tests/test_sessions.py`, `test_csrf.py`, `test_me.py`, `test_guards.py`

**Interfaces:**
- `services/sessions.py`:
  - `utcnow() -> datetime`: naive UTC, as MySQL stores it.
  - `hash_token(token: str) -> str`: SHA-256 hex.
  - `create_session(db: Session, user: User, days: int) -> str`: deletes the user's expired sessions, inserts the row, commits, and returns the raw token (`secrets.token_urlsafe(32)`).
  - `user_for_token(db: Session, token: str) -> User | None`: an expired row is deleted and committed, then returns None.
  - `end_session(db: Session, token: str) -> None`.
- `services/accounts.py`: `upsert_user(db: Session, identity: Identity) -> User`. Find by provider and id, create if missing, update the email if it changed, commit. On IntegrityError, roll back and look up again. `Identity` is defined here for now: `class Identity(NamedTuple): provider: str; provider_user_id: str; email: str | None`. Task 5 re-exports it from `services/oauth.py`.
- `app/auth.py`:
  - `SESSION_COOKIE = "mdit_session"`
  - `current_user(request: Request, db: DbSession) -> User`: raises `ApiError(401, "unauthenticated", "Sign in to continue.")`.
  - `CurrentUser = Annotated[User, Depends(current_user)]`
  - `set_session_cookie(response: Response, token: str, settings: Settings) -> None`
  - `clear_session_cookie(response: Response, settings: Settings) -> None`
- `app/csrf.py`: `CSRF_HEADER = "x-mdit-csrf"` and `class CsrfMiddleware`, a pure ASGI middleware with `__init__(self, app: ASGIApp)` and `async __call__(scope, receive, send)`. For HTTP scopes whose path starts with `/api/` and whose method is POST, PUT, PATCH or DELETE, the header must equal `"1"`; otherwise it sends `error_response(403, "csrf", "This request is missing its CSRF header.")`.
- `schemas/common.py`:
  - `UtcDateTime = Annotated[datetime, PlainSerializer(...)]`: a naive datetime is treated as UTC and serialized as `YYYY-MM-DDTHH:MM:SS.ffffffZ`.
  - `class ErrorBody(BaseModel): code: str; message: str; details: Any = None` and `class ErrorOut(BaseModel): error: ErrorBody`.
  - `error_responses(*statuses: int) -> dict[int | str, dict[str, Any]]`: `{s: {"model": ErrorOut}}`.
- `schemas/me.py`: `class MeOut(BaseModel): id: str; provider: str; email: str | None; created_at: UtcDateTime`.
- Routes:
  - `GET /api/me`: `operation_id="getMe"`, `MeOut`.
  - `POST /api/auth/logout`: `operation_id="logout"`, 204. Works without a session and always clears the cookie.
- `main.py`:
  - `create_app(settings=None, readiness=None, providers: Mapping[str, IdentityProvider] | None = None)`. The `providers` parameter is added in Task 5; until then keep the signature without it.
  - Stores `app.state.settings`.
  - Middleware: `app.add_middleware(CsrfMiddleware)`.
  - Includes the `me` and `auth` routers.
- Test support:
  - `tests/support.py`: `sign_in(client: TestClient, engine: Engine, name: str = "alice") -> User`. It upserts `Identity("dev", name, None)`, calls `create_session`, and sets the cookie with `client.cookies.set(SESSION_COOKIE, token, domain="testserver", path="/api")`.
  - `conftest.py` fixtures:
    - `clean_db(migrated)`: deletes all rows in child-to-parent order before each test (`version_images`, `versions`, `documents`, `projects`, `sessions`, `user_blobs`, `blobs`, `users`).
    - `api_settings(test_settings)`: `test_settings.model_copy(update={"dev_login": True})`.
    - `app(clean_db, blob_store, api_settings)`
    - `client(app)`: `TestClient(app, base_url="https://testserver", headers={"X-MdIt-CSRF": "1"})`. HTTPS is needed so the Secure cookie is sent.
    - `other_client(app)`: a second, independent cookie jar.

- [ ] **Step 1: Write the failing tests:**

```python
# test_sessions.py (integration)
def test_token_is_stored_hashed(...)            # row.token_hash == sha256(token); token not in any column
def test_user_for_token_finds_the_user(...)
def test_expired_session_is_rejected_and_deleted(...)   # expires_at in the past -> None, row gone
def test_new_login_removes_expired_sessions(...)
def test_unknown_token_gives_none(...)

# test_me.py (integration)
def test_me_needs_a_session(client) -> None:
    r = client.get("/api/me")
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthenticated"
def test_me_returns_the_account(client, migrated) -> None:
    user = sign_in(client, migrated, "alice")
    assert client.get("/api/me").json() == {"id": user.public_id, "provider": "dev", "email": None, "created_at": ANY_Z}
def test_logout_ends_the_session(client, migrated) -> None:   # 204, Set-Cookie clears, next /api/me -> 401, row gone
def test_logout_without_session_is_204(client) -> None
def test_two_devices_have_independent_sessions(client, other_client, migrated) -> None:
    # sign_in both as "alice"; logout on client; other_client /api/me still 200
def test_session_cookie_attributes(...)        # set_session_cookie on a Response: HttpOnly, Secure, SameSite=lax, Path=/api, Max-Age=2592000

# test_csrf.py (unit, fake_settings)
@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_mutating_api_request_without_header_is_403(method) -> None   # even on an unknown /api path
def test_wrong_header_value_is_403() -> None                          # "0"
def test_safe_methods_need_no_header() -> None                        # GET /api/health 200
def test_header_lets_the_request_through() -> None                    # POST /api/nothing with header -> 404 not 403

# test_guards.py (integration; walks app.routes, keeps working as later tasks add routes)
PUBLIC = {("GET", "/api/health"), ("GET", "/api/health/ready"), ("GET", "/api/auth/providers"),
          ("GET", "/api/auth/login/{provider}"), ("GET", "/api/auth/callback/{provider}"),
          ("POST", "/api/auth/logout")}
def api_routes(app) -> list[tuple[str, str]]       # (method, path) for every APIRoute and method, HEAD included
def fill(path) -> str                              # {hash} -> "0"*64, any other {param} -> str(uuid4())
def test_every_private_route_needs_a_session(app) -> None:
    # TestClient with the CSRF header, no cookie: each non-PUBLIC route -> 401 unauthenticated
def test_every_mutating_route_needs_the_csrf_header(app, migrated) -> None:
    # without the header, signed in and signed out: every POST/PUT/PATCH/DELETE route -> 403 csrf
def test_guard_sees_the_routes(app) -> None:
    assert ("GET", "/api/me") in api_routes(app)    # the walk isn't vacuous
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** to the interfaces above.
  - `current_user` reads `request.cookies.get(SESSION_COOKIE)` and calls `user_for_token`.
  - Logout reads the cookie, calls `end_session` if it is present, and clears the cookie.

- [ ] **Step 4: Run** the full suite → PASS.

- [ ] **Step 5: Commit** `feat(backend): server-side sessions, CSRF header middleware, /api/me and logout`.

---

### Task 5: OAuth providers

**Files:**
- Create: `backend/app/services/oauth.py`
- Modify: `backend/app/services/accounts.py` (import `Identity` from `oauth.py`), `backend/app/main.py`, `backend/tests/support.py`
- Test: `backend/tests/test_oauth.py`

**Interfaces:**
- `services/oauth.py`:
  - `Identity` (moved here; `accounts.py` imports it).
  - `class ProviderError(Exception)`.
  - `class IdentityProvider(Protocol)` with `name: str`, `authorization_url(self, redirect_uri: str, state: str, code_verifier: str) -> str` and `fetch_identity(self, redirect_uri: str, code: str, code_verifier: str) -> Identity`. Any failure in `fetch_identity` raises `ProviderError`.
  - `class GitHubProvider` and `class GoogleProvider`, each `__init__(self, client_id: str, client_secret: str, transport: httpx2.BaseTransport | None = None)`.
  - `build_providers(settings: Settings) -> dict[str, IdentityProvider]`: enabled providers in the order github, google.
- Constants (exact values): GitHub `https://github.com/login/oauth/authorize`, `https://github.com/login/oauth/access_token`, `https://api.github.com/user`, `https://api.github.com/user/emails`, scope `"read:user user:email"`. Google `https://accounts.google.com/o/oauth2/v2/auth`, `https://oauth2.googleapis.com/token`, `https://openidconnect.googleapis.com/v1/userinfo`, scope `"openid email"`.
- Each call builds `OAuth2Client(client_id, client_secret, scope=…, redirect_uri=redirect_uri, code_challenge_method="S256", token_endpoint_auth_method="client_secret_post", timeout=10, transport=transport)`. For GitHub, also send `Accept: application/vnd.github+json` on API calls.
- `main.py`: `create_app(..., providers=None)` uses `build_providers(settings)` when `providers` is None and stores the result in `app.state.providers`.
- `tests/support.py`: `class FakeProvider` with `__init__(self, name: str = "github", identity: Identity | None = None, error: bool = False)`.
  - `authorization_url` returns `f"https://provider.test/authorize?state={state}"` and records `self.last_verifier`.
  - `fetch_identity` records `self.last_code`; it raises `ProviderError` if `error` is set, and otherwise returns `identity` (default `Identity(name, "1001", "alice@example.com")`).

- [ ] **Step 1: Write the failing tests** (`httpx2.MockTransport` handlers keyed on `request.url.path`):

```python
def test_github_authorization_url_uses_pkce_s256() -> None:
    url = GitHubProvider("cid", "sec").authorization_url(REDIRECT, "st", "v" * 64)
    q = parse_qs(urlparse(url).query)
    assert q["state"] == ["st"] and q["code_challenge_method"] == ["S256"] and q["scope"] == ["read:user user:email"]
    assert q["code_challenge"] == [base64url(sha256("v"*64))] and q["redirect_uri"] == [REDIRECT]
def test_github_identity_uses_primary_verified_email() -> None:
    # token body has code, code_verifier, client_id, client_secret; /user {"id": 42}; emails list
    assert provider.fetch_identity(REDIRECT, "c", "v"*64) == Identity("github", "42", "primary@x.io")
def test_github_unverified_primary_email_is_null() -> None
def test_github_email_lookup_failure_gives_null_email() -> None     # Review Focus 5: /user/emails -> 404
def test_github_token_error_raises_provider_error() -> None         # {"error": "bad_verification_code"}
def test_github_user_failure_raises_provider_error() -> None        # /user -> 500
def test_google_identity_from_userinfo() -> None                    # {"sub": "g-1", "email": "a@x", "email_verified": True}
def test_google_unverified_email_is_null() -> None
def test_google_network_error_raises_provider_error() -> None        # handler raises httpx2.ConnectError
def test_build_providers_follows_settings() -> None:
    assert list(build_providers(fake_settings(github_client_id="i", github_client_secret=SecretStr("s")))) == ["github"]
    assert build_providers(fake_settings()) == {}
```

- [ ] **Step 2: Run** `python -m uv run pytest tests/test_oauth.py -v` → FAIL.

- [ ] **Step 3: Implement.**
  - Wrap `authlib.integrations.base_client.OAuthError`, `httpx2.HTTPError` and non-2xx responses from `/user` or userinfo into `ProviderError`. Never put the code or tokens in the message.
  - A failed `/user/emails` call gives `email=None`; it is not an error.

- [ ] **Step 4: Run** the full suite → PASS.

- [ ] **Step 5: Commit** `feat(backend): GitHub and Google identity providers with PKCE`.

---

### Task 6: Sign-in routes and access-log redaction

**Files:**
- Modify: `backend/app/routes/auth.py`, `backend/app/auth.py`, `backend/app/logging.py`, `backend/app/main.py`
- Create: `backend/app/schemas/auth.py`
- Test: `backend/tests/test_auth_routes.py`, `backend/tests/test_logging.py`

**Interfaces:**
- `schemas/auth.py`: `class ProvidersOut(BaseModel): providers: list[str]`.
- `app/auth.py`: `safe_next(value: str | None) -> str`. It returns `value` only if it starts with `/`, doesn't start with `//` or `/\`, and is at most 2048 characters; otherwise `"/"`.
- Routes, all in `routes/auth.py`:
  - `GET /api/auth/providers`: `operation_id="listProviders"`, `ProvidersOut`. Returns `[*app.state.providers, "dev"]` when `settings.dev_login`, without `dev` otherwise.
  - `GET /api/auth/login/{provider}`: `operation_id="startLogin"`, with query `next: str | None` and `name: str | None`. Returns a 302 `RedirectResponse`.
    - For `provider == "dev"` with `dev_login` on: validate `name` against `^[a-z0-9_-]{1,64}$` (otherwise `ApiError(422, "invalid_request", …)`), call `upsert_user(Identity("dev", name, None))` and `create_session`, set the cookie, and redirect to `safe_next(next)`.
    - For an enabled provider: store `request.session["oauth"] = {"provider", "state", "verifier", "next"}`. `state` is `secrets.token_urlsafe(32)`, `verifier` is `secrets.token_urlsafe(64)`, and `next` is `safe_next(next)`. Redirect to `authorization_url(redirect_uri, state, verifier)`, where `redirect_uri` is `f"{settings.public_base_url}/api/auth/callback/{provider}"`.
    - Anything else: 404 `not_found`.
  - `GET /api/auth/callback/{provider}`: `operation_id="finishLogin"`, with query `code`, `state` and `error`, all optional.
    - It always clears `request.session`.
    - Order of checks: `error == "access_denied"` → `denied`; any other `error` → `provider`; a missing, mismatched or other-provider saved state → `state` (compare with `secrets.compare_digest`); `ProviderError` from `fetch_identity` → `provider`. Each failure redirects to `/?login_error=<code>` and logs WARNING `"Sign-in failed: %s (%s)"` with the kind and provider only.
    - On success: `upsert_user`, `create_session`, set the cookie, and redirect to the saved `next`.
- `main.py`:
  - `app.add_middleware(SessionMiddleware, secret_key=settings.session_secret.get_secret_value(), session_cookie="mdit_oauth", max_age=600, path="/api/auth", same_site="lax", https_only=settings.cookie_secure)`.
  - With `dev_login` on, log WARNING `"DEV_LOGIN is on: anyone can sign in as any dev user. Never enable it outside local development."` once in `create_app`.
- `app/logging.py`: `class RedactAuthQuery(logging.Filter)` rewrites `record.args[2]`, the path with its query string in Uvicorn's access record `(client, method, path, http_version, status)`. For paths starting with `/api/auth/callback/` or `/api/auth/login/`, everything from `?` becomes `?…`. `configure_logging` adds the filter to `logging.getLogger("uvicorn.access")` once; check with `isinstance` so repeated `create_app` calls don't stack filters.

- [ ] **Step 1: Write the failing tests** (`client` from Task 4 with `follow_redirects=False` per call; `app` built with `providers={"github": FakeProvider()}`; extend the `app` fixture to accept them):

```python
def test_providers_lists_enabled_ones(client) -> None:
    assert client.get("/api/auth/providers").json() == {"providers": ["github", "dev"]}
def test_providers_without_dev_login(...) -> None                      # dev_login False -> ["github"]
def test_login_redirects_to_provider_with_state(client) -> None:
    r = client.get("/api/auth/login/github?next=/p/1", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"].startswith("https://provider.test/authorize?state=")
    assert "mdit_oauth=" in r.headers["set-cookie"] and "path=/api/auth" in r.headers["set-cookie"].lower()
def test_unknown_or_disabled_provider_is_404(client) -> None            # /login/google and /login/nope
def test_callback_signs_in_and_redirects_to_next(client, fake) -> None:
    start = client.get("/api/auth/login/github?next=/p/1", follow_redirects=False)
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    r = client.get(f"/api/auth/callback/github?code=abc&state={state}", follow_redirects=False)
    assert r.headers["location"] == "/p/1" and fake.last_code == "abc"
    assert client.get("/api/me").json()["email"] == "alice@example.com"
def test_callback_reuses_the_existing_user_and_updates_email(...) -> None
def test_callback_with_wrong_state(client) -> None                     # location == "/?login_error=state"
def test_callback_without_state_cookie(client) -> None                 # Review Focus 2: fresh client, no /login first
def test_state_is_single_use(client) -> None                          # replaying the same callback -> login_error=state
def test_callback_denied(client) -> None                              # ?error=access_denied -> login_error=denied
def test_callback_provider_failure(client) -> None                    # FakeProvider(error=True) -> login_error=provider
@pytest.mark.parametrize("next_, expected", [("/p/1", "/p/1"), ("//evil.example", "/"), ("/\\evil", "/"),
                                             ("https://evil.example", "/"), (None, "/"), ("/" + "a" * 2048, "/")])
def test_safe_next(next_, expected) -> None
def test_dev_login(client) -> None                                     # /login/dev?name=alice -> 302 "/", /api/me provider "dev"
@pytest.mark.parametrize("name", ["", "Alice", "a b", "x" * 65, None])
def test_dev_login_rejects_bad_names(client, name) -> None             # 422
def test_dev_login_off_is_404(...) -> None
def test_dev_login_warning_logged(caplog) -> None

# test_logging.py
def test_callback_query_is_redacted() -> None:
    record = logging.LogRecord("uvicorn.access", 20, "", 0, '%s - "%s %s HTTP/%s" %d',
                               ("1.2.3.4:5", "GET", "/api/auth/callback/github?code=SECRET&state=S", "1.1", 302), None)
    RedactAuthQuery().filter(record)
    assert "SECRET" not in record.getMessage() and "/api/auth/callback/github?…" in record.getMessage()
def test_other_paths_are_untouched() -> None                           # /api/projects?x=1 unchanged
def test_filter_added_once() -> None                                   # configure_logging twice -> one RedactAuthQuery
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** to the interfaces.

- [ ] **Step 4: Run** the full suite → PASS (the guard tests now include the auth routes, all in `PUBLIC`).

- [ ] **Step 5: Commit** `feat(backend): sign-in routes for GitHub, Google and dev, with redacted access logs`.

---

### Task 7: Blob uploads and downloads

**Files:**
- Modify: `backend/app/storage/blobs.py`, `backend/app/main.py`
- Create: `backend/app/services/blobs.py`, `backend/app/routes/blobs.py`
- Test: `backend/tests/test_blobs.py` (add `delete`), `backend/tests/test_blob_routes.py`, `backend/tests/test_blob_checks.py`

**Interfaces:**
- `storage/blobs.py`: `is_blob_hash(value: str) -> bool` (the existing `_HASH`); `BlobStore.delete(self, hash: str) -> None` (missing object is fine).
- `services/blobs.py`:
  - `MAX_BLOB_BYTES = 5 * 1024 * 1024`
  - `ALLOWED_TYPES = frozenset({"text/markdown", "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"})`
  - `media_type(header: str | None) -> str`: lower-cased, with parameters stripped.
  - `check_content(content_type: str, data: bytes) -> None`: raises `ApiError(415, "unsupported_type", …)`.
    - Magic bytes: PNG `\x89PNG\r\n\x1a\n`; JPEG `\xff\xd8\xff`; GIF `GIF87a` or `GIF89a`; WebP `RIFF` + 4 bytes + `WEBP`.
    - SVG: `defusedxml.ElementTree.fromstring(data, forbid_dtd=True)` with root tag `svg` or `{http://www.w3.org/2000/svg}svg`; any parse error or `DefusedXmlException` → 415.
    - Markdown: `data.decode("utf-8")` must succeed.
  - `async read_limited(request: Request, limit: int = MAX_BLOB_BYTES) -> bytes`: a `Content-Length` over the limit → `ApiError(413, "too_large", …)` before reading. It streams `request.stream()` and raises the same error once the total passes the limit.
  - `store_blob(db: Session, store: BlobStore, user: User, hash: str, content_type: str, data: bytes) -> bool`: True when newly owned by the user.
    - Implements spec §6.5 steps 4–6: SHA-256 mismatch → `ApiError(422, "hash_mismatch", …)`; `check_content`; `store.put` only when the `blobs` row is missing.
    - The row insert uses `INSERT … ON DUPLICATE KEY UPDATE hash = hash` (`sqlalchemy.dialects.mysql.insert`), and the same for `user_blobs`.
    - An IntegrityError on the `user_blobs` insert (FK, blob row swept) → rollback and run once more from the start.
  - `owned_blob(db: Session, user: User, hash: str) -> Blob | None`.
- `routes/blobs.py`:
  - `HEAD /api/blobs/{hash}`: `operation_id="blobExists"`, `status_code=200`, empty body.
  - `PUT /api/blobs/{hash}`: `operation_id="uploadBlob"`, an `async def`. It reads with `read_limited` and calls `store_blob` through `run_in_threadpool`; 201 or 200 with body `{"hash": str, "size": int, "content_type": str}` (`BlobOut` in `schemas/blobs.py`). The OpenAPI `requestBody` is declared via `openapi_extra` with each allowed content type as binary.
  - `GET /api/blobs/{hash}`: `operation_id="getBlob"`, a `Response` with the spec §6.5 headers exactly.
  - An invalid hash gives 404 `not_found` on every method. A missing object for an existing row → log ERROR and raise `ApiError(500, "internal_error", "Something went wrong.")`.

- [ ] **Step 1: Write the failing tests** (`sha = hashlib.sha256(b).hexdigest()`; tiny bodies such as `PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 16`):

```python
def test_upload_then_head_and_get(client, migrated) -> None:
    sign_in(client, migrated)
    r = client.put(f"/api/blobs/{sha(MD)}", content=MD, headers={"Content-Type": "text/markdown"})
    assert r.status_code == 201 and r.json() == {"hash": sha(MD), "size": len(MD), "content_type": "text/markdown"}
    assert client.head(f"/api/blobs/{sha(MD)}").status_code == 200
    g = client.get(f"/api/blobs/{sha(MD)}")
    assert g.content == MD and g.headers["content-type"].startswith("text/markdown")
    assert g.headers["x-content-type-options"] == "nosniff"
    assert g.headers["content-security-policy"] == "sandbox; default-src 'none'"
    assert g.headers["content-disposition"] == "attachment"
    assert g.headers["cache-control"] == "private, max-age=31536000, immutable"
def test_second_upload_by_same_user_is_200(...)
def test_other_users_cannot_see_a_blob(client, other_client, migrated) -> None   # HEAD/GET 404 for user B
def test_dedup_across_users_one_object_two_owners(...)      # B uploads same bytes -> 201; one blobs row, two user_blobs rows
def test_hash_mismatch_is_422(...)
def test_too_large_is_413(...)                              # MAX_BLOB_BYTES + 1 bytes
def test_unsupported_type_is_415(...)                       # application/pdf
@pytest.mark.parametrize("ctype, body", [("image/png", b"GIF89a..."), ("image/jpeg", PNG), ("image/webp", b"RIFF0000WAVE"),
    ("text/markdown", b"\xff\xfe"), ("image/svg+xml", b"<html/>"),
    ("image/svg+xml", b'<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>')])
def test_content_must_match_type(ctype, body) -> None        # 415 unsupported_type (unit test on check_content)
def test_valid_svg_accepted() -> None
def test_content_type_parameters_are_ignored(...)           # Review Focus 3: "text/markdown; charset=utf-8" -> 201
def test_invalid_hash_is_404(...)                            # "ABC", uppercase hex, 63 chars
def test_upload_retries_after_a_swept_row(...)               # monkeypatch the first user_blobs insert to raise IntegrityError once -> 201
def test_store_delete_missing_is_fine(blob_store) -> None
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** to the interfaces. Include the router in `main.py`.

- [ ] **Step 4: Run** the full suite → PASS (the guard tests cover HEAD, PUT and GET blob routes).

- [ ] **Step 5: Commit** `feat(backend): verified blob uploads with per-user ownership and sandboxed downloads`.

---

### Task 8: Projects and documents API

**Files:**
- Create: `backend/app/schemas/paths.py`, `schemas/projects.py`, `schemas/documents.py`, `services/projects.py`, `routes/projects.py`, `routes/documents.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_paths.py`, `backend/tests/test_projects.py`, `backend/tests/test_documents.py`

**Interfaces:**
- `schemas/paths.py`:
  - `check_path(value: str, *, markdown: bool) -> str` raises `ValueError` with a plain message.
  - The rule is spec §6.3 exactly: 1–1024 characters; no leading or trailing `/`; no empty, `.` or `..` segments; no `\`; no characters below U+0020 or U+007F. When `markdown` is set, it must end in `.md`, case-insensitive.
  - `DocumentPath = Annotated[str, AfterValidator(lambda v: check_path(v, markdown=True))]`
  - `ImagePath = Annotated[str, AfterValidator(lambda v: check_path(v, markdown=False))]`
- `schemas/projects.py`: `ProjectName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]`; `ProjectIn(name: ProjectName)`; `ProjectOut(id: str, name: str, created_at: UtcDateTime, document_count: int)`.
- `schemas/documents.py`: `LatestOut(id: str, number: int, created_at: UtcDateTime)`; `DocumentIn(path: DocumentPath)`; `DocumentOut(id: str, path: str, created_at: UtcDateTime, latest: LatestOut | None)`.
- `services/projects.py`:
  - `get_project(db: Session, user: User, project_id: str) -> Project`
  - `get_document(db: Session, user: User, document_id: str, *, for_update: bool = False) -> Document`: joins through the project to the user; `for_update` adds `.with_for_update(of=Document)`.
  - `NOT_FOUND = ApiError(404, "not_found", "Not found.")`, raised fresh each time with a factory `not_found()`.
  - `list_projects(db, user) -> list[ProjectOut]`, newest first, with counts.
  - `create_project`, `rename_project`, `delete_project`.
  - `list_documents(db, user, project_id) -> list[DocumentOut]`, by path, with `latest` from the highest-numbered remaining version.
  - `create_document(db, user, project_id, path) -> DocumentOut` and `delete_document(db, user, document_id) -> None`.
- Routes and `operation_id`s:
  - `GET /api/projects`: `listProjects`, `list[ProjectOut]`
  - `POST /api/projects`: `createProject`, 201
  - `PATCH /api/projects/{project_id}`: `renameProject`
  - `DELETE /api/projects/{project_id}`: `deleteProject`, 204
  - `GET /api/projects/{project_id}/documents`: `listDocuments`
  - `POST /api/projects/{project_id}/documents`: `createDocument`, 201
  - `DELETE /api/documents/{document_id}`: `deleteDocument`, 204
  - Each declares `responses=error_responses(401, 404, 422)` where they apply.
- A non-UUID id in the path is simply not found (404), never 422: path params are `str`.

- [ ] **Step 1: Write the failing tests:**

```python
# test_paths.py (unit)
@pytest.mark.parametrize("ok", ["a.md", "notes/Plan.MD", "日本/メモ.md", "a b/c.md"])
def test_document_paths_accepted(ok) -> None
@pytest.mark.parametrize("bad", ["", "/a.md", "a.md/", "a//b.md", "./a.md", "a/../b.md", "a\\b.md", "a\x00.md",
                                 "a\x7f.md", "a.txt", "x" * 1022 + ".md"])
def test_document_paths_rejected(bad) -> None
def test_image_path_needs_no_md_suffix() -> None

# test_projects.py / test_documents.py (integration)
def test_create_list_rename_delete_project(client, migrated) -> None:
    sign_in(client, migrated)
    p = client.post("/api/projects", json={"name": "  Notes  "}).json()
    assert p["name"] == "Notes" and p["document_count"] == 0
    assert client.patch(f"/api/projects/{p['id']}", json={"name": "Work"}).json()["name"] == "Work"
    assert [x["id"] for x in client.get("/api/projects").json()] == [p["id"]]
    assert client.delete(f"/api/projects/{p['id']}").status_code == 204
def test_projects_newest_first(...)
@pytest.mark.parametrize("name", ["", "   ", "x" * 256])
def test_bad_project_name_is_422(...)
def test_other_users_project_is_404(client, other_client, migrated) -> None   # GET docs, PATCH, DELETE, POST doc -> 404
def test_unknown_or_malformed_ids_are_404(...)                                 # "nope", str(uuid4())
def test_create_and_list_documents(...)          # latest is None; sorted by path; document_count updates
def test_bad_document_path_is_422(...)           # "a.txt"
def test_delete_document(...)                    # 204, then gone from the list
def test_deleting_project_keeps_users_blobs(...) # user_blobs rows survive
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** to the interfaces; services commit once per mutation.

- [ ] **Step 4: Run** the full suite → PASS.

- [ ] **Step 5: Commit** `feat(backend): projects and documents API scoped to the signed-in user`.

---

### Task 9: Versions API

**Files:**
- Create: `backend/app/schemas/versions.py`, `services/versions.py`, `routes/versions.py`
- Modify: `backend/app/main.py`, `backend/app/services/projects.py` (`latest` reuse)
- Test: `backend/tests/test_versions.py`

**Interfaces:**
- `schemas/versions.py`:
  - `ImageRef(path: ImagePath, hash: str)`, with `hash` matching `^[0-9a-f]{64}$`.
  - `VersionIn(parent_version_id: str | None, content_hash: str, message: str | None = None, path: DocumentPath, images: list[ImageRef] = [])`.
    - `message` is at most 500 characters, and an empty or whitespace-only message becomes None.
    - `images` has at most 500 entries.
    - A model validator rejects paths duplicated case-insensitively (`casefold()`), with the message `"Each image path may appear only once."`.
  - `VersionSummary(id: str, number: int, message: str | None, parent_id: str | None, created_at: UtcDateTime)`.
  - `VersionDetail(VersionSummary)`, adding `document_id: str`, `content_hash: str` and `images: list[ImageRef]`.
- `services/versions.py`:
  - `latest_version(db: Session, document: Document, *, lock: bool = False) -> Version | None`: highest number. With `lock=True` it is a **locking read** (`.with_for_update()`), as required by spec §6.4 step 3 and the planning probe.
  - `save_version(db: Session, user: User, document_id: str, body: VersionIn) -> VersionDetail`, following spec §6.4 steps 2–5 in order.
    - Conflict: `ApiError(409, "version_conflict", "A newer version was saved. Load it or save yours as a copy.", {"latest": LatestOut | None as dict})`.
    - Missing hashes: `ApiError(422, "blob_missing", "Upload these blobs first.", {"missing": [sorted hashes]})`.
    - A content blob that isn't `text/markdown`: `ApiError(422, "blob_missing", "The content must be a Markdown blob.", {"missing": [content_hash]})`.
  - `list_versions(db, user, document_id) -> list[VersionSummary]`, newest first.
  - `get_version(db, user, version_id) -> VersionDetail`.
  - `delete_version(db, user, version_id) -> None`.
- Routes and `operation_id`s:
  - `GET /api/documents/{document_id}/versions`: `listVersions`
  - `POST /api/documents/{document_id}/versions`: `saveVersion`, 201, `responses=error_responses(401, 404, 409, 422)`
  - `GET /api/versions/{version_id}`: `getVersion`
  - `DELETE /api/versions/{version_id}`: `deleteVersion`, 204

- [ ] **Step 1: Write the failing tests.** Fixture helper: `doc(client) -> str`, and `upload(client, data, type) -> hash`.

```python
def test_first_save_is_version_1(...):        # parent None -> 201 number 1, parent_id None, images echoed
def test_first_save_with_a_parent_is_409(...)   # random parent id, no versions -> 409, details.latest None
def test_save_on_latest_increments(...)       # v2.parent_id == v1.id, number 2
def test_stale_parent_is_409_with_latest(...):
    assert r.status_code == 409 and r.json()["error"]["details"]["latest"]["number"] == 2
def test_save_sees_a_version_committed_after_its_snapshot(migrated, blob_store) -> None:
    # deterministic REPEATABLE READ regression (planning probe):
    # Session B: plain SELECT on versions (fixes the snapshot); Session A: save_version(parent=v1) commits v2;
    # Session B: save_version(parent=v1) -> ApiError 409, and document.next_number == 3
def test_concurrent_saves_one_wins(migrated, blob_store) -> None:
    # two threads, separate Sessions, threading.Barrier before save_version(parent=v1): exactly one 201-equivalent, one 409
def test_numbers_are_not_reused_after_delete(...)   # v1, v2; delete v2; save on v1 -> number 3
def test_deleting_latest_makes_previous_latest(...) # list_documents latest == v1 after deleting v2
def test_deleting_parent_nulls_child_parent(...)    # delete v1 -> v2.parent_id None
def test_unowned_content_hash_is_422(...)           # details.missing == [hash]
def test_other_users_blob_is_not_owned(client, other_client, ...)  # B's uploaded hash used by A -> 422 blob_missing
def test_unowned_image_hash_is_422(...)
def test_content_must_be_markdown_blob(...)          # PNG hash as content_hash -> 422
def test_duplicate_image_paths_ignore_case(...)      # Review Focus 4: "images/A.png" + "images/a.png" -> 422
def test_too_many_images_or_long_message_is_422(...)  # 501 images; 501-char message
def test_blank_message_becomes_null(...)
def test_save_updates_document_path(...)            # path "renamed/Doc.md" -> list_documents shows it
def test_get_version_detail(...)                    # document_id, content_hash, images
def test_list_versions_newest_first(...)
def test_versions_of_other_users_are_404(...)       # list, save, get, delete
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `save_version` in one transaction. Order:
  1. Lock the document with `get_document(..., for_update=True)`.
  2. Read `latest_version(lock=True)` and check the parent.
  3. Check ownership in one query: `SELECT hash FROM user_blobs WHERE user_id = :u AND hash IN (...)`.
  4. Check the content blob's type.
  5. Insert the version with `number=document.next_number`, increment `next_number`, set `path`, add `VersionImage` rows, and commit.

  Map `parent_version_id` (a public id) to the internal id through the latest version, never by looking up an arbitrary version.

- [ ] **Step 4: Run** the full suite → PASS.

- [ ] **Step 5: Commit** `feat(backend): linear per-document versions with conflict detection and image snapshots`.

---

### Task 10: Account deletion, OpenAPI and log checks

**Files:**
- Modify: `backend/app/services/accounts.py`, `backend/app/routes/me.py`
- Test: `backend/tests/test_accounts.py`, `backend/tests/test_openapi.py`, `backend/tests/test_no_secrets_in_logs.py`

**Interfaces:**
- `services/accounts.py`: `delete_account(db: Session, store: BlobStore, user: User) -> None`.
  - Collect the user's owned hashes, then `db.delete(user)` and commit.
  - Then run `sweep_blob(db, store, hash) -> bool` for each hash; it returns True when the blob was removed.
  - `sweep_blob` works in its own transaction:
    1. `SELECT … FROM blobs WHERE hash = :h FOR UPDATE`; if the row is gone, return False.
    2. Locking-read `user_blobs` for the hash; if any row exists, return False.
    3. `store.delete(hash)`. On `AzureError`, log WARNING `"Could not delete blob %s; left for cleanup"` and return False with the row kept.
    4. Delete the row and commit.
- `routes/me.py`: `DELETE /api/me`, `operation_id="deleteAccount"`, 204; clears the session cookie.

- [ ] **Step 1: Write the failing tests:**

```python
def test_delete_account_removes_everything(client, migrated, blob_store) -> None:
    # alice: project, doc, md + png blobs, 2 versions; DELETE /api/me -> 204
    # users/projects/documents/versions/version_images/sessions/user_blobs rows for alice: 0
    # blob rows and Azurite objects for her hashes: gone (blob_store.get(h) is None)
    # /api/me -> 401
def test_delete_account_keeps_blobs_others_own(client, other_client, migrated, blob_store) -> None
    # bob uploaded the same png -> after alice's delete, blob row + object remain and bob can GET it
def test_delete_account_ends_every_session(...)        # two signed-in clients; both -> 401
def test_storage_failure_keeps_the_row(...)            # store.delete raising AzureError -> account gone, blob row kept, warning logged

# test_openapi.py
def test_every_route_has_an_operation_id_and_responses(app) -> None:
    spec = app.openapi()
    ids = [op["operationId"] for path in spec["paths"].values() for op in path.values()]
    assert len(ids) == len(set(ids)) and all(re.fullmatch(r"[a-z][A-Za-z]+", i) for i in ids)
    # every /api/... operation except the health ones has a 2xx response with a schema or is 204/302
def test_openapi_lists_the_5a_routes(app) -> None      # the 20 (method, path) pairs from spec §5.1, §6.2–6.5 (+ the 2 health routes)

# test_no_secrets_in_logs.py
def test_auth_and_save_flow_logs_no_secrets(client, migrated, caplog) -> None:
    # caplog.set_level(DEBUG) on the root logger; dev login, create doc, upload "SECRET-CONTENT-123", save, logout
    # the session token (from client.cookies) and "SECRET-CONTENT-123" do not appear in caplog.text
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** to the interfaces.

- [ ] **Step 4: Run** the full suite → PASS.

- [ ] **Step 5: Commit** `feat(backend): account deletion removes the user's versions and unshared blobs`.

---

### Task 11: Compose, gateway, smoke script, CI and README

**Files:**
- Modify: `docker-compose.yml`, `.env.example`, `gateway/default.conf`, `.github/workflows/ci.yml`, `README.md`
- Create: `scripts/api_smoke.py`

**Interfaces:**
- `scripts/api_smoke.py BASE_URL`: Python 3 stdlib only (`urllib.request`, `http.cookiejar`, `hashlib`, `json`). It exits 0 on success and 1 with a one-line reason on the first mismatch.
  - Two opener/jar pairs, A and B. Every mutating request sends `X-MdIt-CSRF: 1`.
  - The dev login uses a no-redirect handler and checks for a 302.
  - Steps (spec §12):
    1. A and B both dev-login as `smoke-<random hex>`.
    2. A creates project `Smoke` and document `notes/Smoke.md`.
    3. A uploads Markdown v1, Markdown v2 and a PNG (`b"\x89PNG\r\n\x1a\n" + bytes(16)`).
    4. A saves v1, then v2 on v1, with image `notes/images/dot.png`.
    5. B finds the project via `GET /api/projects`, then the document via `/documents`. The latest number must be 2.
    6. B does `GET /api/versions/{latest}` and fetches both blobs, checking their SHA-256.
    7. A saves on v1 and gets 409 `version_conflict`.
    8. A sends `DELETE /api/me` (204); B's `GET /api/me` then gets 401.
- `docker-compose.yml`:
  - The `x-backend-env` anchor gains `PUBLIC_BASE_URL: ${PUBLIC_BASE_URL:-http://localhost:8080}`, `SESSION_SECRET: ${SESSION_SECRET:-mdit-dev-session-secret-change-me-0000}`, `SESSION_DAYS: ${SESSION_DAYS:-30}`, `COOKIE_SECURE: ${COOKIE_SECURE:-true}`, `DEV_LOGIN: ${DEV_LOGIN:-1}`, and `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` as `${VAR:-}`.
  - The `migrate` service shares the env, because Settings now requires the new fields.
- `.env.example`: those variables, with the development-only comment from spec §8.
- `gateway/default.conf`: `resolver 127.0.0.11 valid=10s ipv6=off;` plus `set $backend_upstream http://backend:8000;` and `proxy_pass $backend_upstream;`, and the same for the frontend. Keep the headers and `client_max_body_size 6m`.
- `ci.yml`:
  - setup-uv gets `cache-dependency-glob: uv.lock`.
  - The `changes` backend filter adds `'scripts/**'`.
  - The `compose` job adds step `API smoke` running `python3 scripts/api_smoke.py http://localhost:8080`.
- README:
  - A "Sign-in" section: dev login URL `http://localhost:8080/api/auth/login/dev?name=you`, registering GitHub and Google OAuth apps (callback URLs), the `.env` variables, the `npm run dev` note from spec §8, and how to run the smoke script.
  - The status line becomes "Phase 5a".

- [ ] **Step 1: Write the smoke script.** Run it against a stack that doesn't have this branch's backend yet (`docker compose up -d` from main's images, or before rebuilding). It must fail at the dev login with exit 1. This is the failing test.

- [ ] **Step 2: Update Compose, `.env.example` and the gateway; run** `docker compose up -d --build --wait`. All services are healthy and `migrate` exited 0 after applying 0002 (`docker compose logs migrate` shows `Running upgrade 0001 -> 0002`).

- [ ] **Step 3: Run** `python scripts/api_smoke.py http://localhost:8080` → exit 0.

- [ ] **Step 4: Gateway re-resolve check.** `docker compose up -d --force-recreate --no-deps backend`, wait for it to be healthy, then `curl -fsS http://localhost:8080/api/health` → 200 without restarting the gateway.

- [ ] **Step 5: Access-log check.** `curl -s -o /dev/null "http://localhost:8080/api/auth/login/dev?name=logcheck&next=/x"`. Then `docker compose logs backend | grep "/api/auth/login/dev"` shows `?…`, and `logcheck` doesn't appear in the access line.

- [ ] **Step 6: CI and README edits; run** `actionlint .github/workflows/ci.yml`, or if actionlint isn't installed, rehearse the backend job steps locally.

- [ ] **Step 7: Commit** `ci: API smoke in the compose job; Compose auth settings; gateway re-resolves upstreams`.

---

### Task 12: Verification

**Files:**
- Modify: `context.md`, `README.md` (status only if Task 11 missed anything)

- [ ] **Step 1: Run from clean.** `docker compose down -v && docker compose up -d --build --wait` → all services up and `migrate` exited 0 (acceptance 1). Then run `python scripts/api_smoke.py http://localhost:8080` → 0 (acceptance 2).

- [ ] **Step 2: Backend from a fresh venv.** Delete `backend/.venv`, then `python -m uv sync --locked`, `ruff check`, `ruff format --check`, `mypy app` and `MDIT_REQUIRE_SERVICES=1 python -m uv run pytest` → all pass with 0 skipped (acceptance 4, 5, 7). Record the test count.

- [ ] **Step 3: OpenAPI.** `curl -s http://localhost:8080/api/openapi.json` lists every 5a route with an `operationId` (acceptance 6).

- [ ] **Step 4: Frontend unchanged.** `git diff main --stat -- frontend/` is empty (acceptance 8, part).

- [ ] **Step 5: Hand acceptance 3 (real GitHub sign-in) to the user** with the README steps; record whether it was done.

- [ ] **Step 6: Commit** `docs: Phase 5a verification`, with the `context.md` log line (counts, image sizes, anything skipped) and Current state set to "5a built — final review next".

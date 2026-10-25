# Phase 5a — Login and versions API: design

Status: approved in sections 2026-10-25 · Branch: `phase-5-login-versions` · PRD: §6, §8, §9.2–9.3, §10.4, §12, §13

## 1. Goal

The backend half of PRD Phase 5. After 5a, the API can do everything the browser needs for accounts and version history; 5b (a separate spec → plan → PR cycle, P-057) builds the frontend `api/`, `auth/` and `sync/` modules on it.

- Sign in with GitHub or Google (Authlib), plus a development-only `dev` provider; server-side sessions in an httpOnly cookie; CSRF protection; log out; view and delete the account
- Projects, documents and per-document linear versions with conflict detection (409)
- Content-addressed blobs (version text and images) with per-user ownership, verified uploads and safe downloads
- A version is a snapshot of one document's text and the images it uses (`version_images`)
- Migration `0002` for the new tables and columns

**Done when:** CI is green on the PR, and the `compose` job's API smoke script passes: two independent cookie jars sign in as the same user; one saves versions with an image; the other lists the project and downloads the latest version and its image with matching hashes; a stale save gets 409. This is PRD §13's "save on one browser, restore on another" at API level; 5b proves it in real browsers. Every item in §13 of this spec passes.

**Out of scope:** all frontend work (5b); rate limiting (Ingress, Phase 6); the periodic orphan-blob cleanup job (only the account-delete sweep, §7.4); version diff and pruning (D5); Kubernetes manifests (Phase 6); the deferred Phase 1–3 frontend minors in `context.md`.

## 2. Decisions this spec depends on

Recorded in `decisions.md`:

- **P-057** Phase 5 is two cycles: 5a backend, 5b frontend.
- **P-058** Real GitHub and Google OAuth via Authlib, each enabled by its env vars, plus a `dev` provider enabled only by `DEV_LOGIN=1`.
- **P-059** Server-side sessions: the cookie holds a random token, MySQL stores its SHA-256.
- **P-060** `version_images (version_id, path, hash)`: each version lists the images its document uses.
- **P-061** Per-user blob ownership (`user_blobs`); HEAD/GET answer only for owned blobs; account delete sweeps blobs nobody owns.
- **P-062** `documents.next_number` counter; version saves lock the document row; 409 when the parent is not the latest.
- **P-063** API additions to PRD §8: `GET /api/auth/providers`, `PATCH /api/projects/{id}`, `POST /api/projects/{id}/documents`, `DELETE /api/documents/{id}`; version saves carry the document path.
- **P-064** CSRF: SameSite=Lax plus a required `X-MdIt-CSRF: 1` header on every mutating `/api` request.
- **P-065** SVG uploads are checked, not sanitized; every blob is served as a sandboxed attachment.
- **P-066** Phase 4 deferred items folded into 5a (readiness accepts newer revisions, gateway re-resolves upstreams, CI and test fixes).
- **P-067** Testing: providers behind an `IdentityProvider` protocol; guard tests walk `app.routes`; a two-cookie-jar API smoke in the `compose` CI job.

Unchanged from Phase 4: P-047 (tests on real MySQL and Azurite), P-049 (schema conventions), P-050 (health), P-051 (migrations as their own step), P-052 (env config, one error shape).

## 3. Repository layout (new and changed)

```
backend/
  app/
    main.py                 + routers, SessionMiddleware for the OAuth state cookie, access-log filter
    config.py               + auth settings (§10)
    csrf.py                 dependency: mutating requests need X-MdIt-CSRF: 1
    auth.py                 current_user dependency (401), session cookie helpers
    db/models.py            + Session, UserBlob, VersionImage; Document.next_number; provider CHECK
    db/session.py           hide_parameters=True
    readiness.py            newer revision counts as ready
    errors.py               non-standard status codes never raise
    schemas/                Pydantic request/response models (DTOs), separate from db/models
    services/
      sessions.py           create, look up, end sessions; expired-session cleanup
      oauth.py              IdentityProvider protocol, GitHub, Google, provider registry
      blobs.py              upload checks (size, hash, type), ownership
      versions.py           save with conflict check, list, get, delete
      accounts.py           user upsert, account delete and blob sweep
    routes/
      auth.py  me.py  projects.py  documents.py  versions.py  blobs.py  health.py
  alembic/versions/0002_sessions_ownership_version_images.py
  tests/                    + one test module per route/service, guard tests, migration 0002
scripts/api-smoke.sh        two-cookie-jar end-to-end check (§12)
docker-compose.yml          backend gets auth env vars, DEV_LOGIN=1
.env.example                + SESSION_SECRET (dev only), optional OAuth client vars
gateway/default.conf        resolver + variable proxy_pass
.github/workflows/ci.yml    setup-uv cache glob; compose job runs the smoke script
README.md                   sign-in setup, registering OAuth apps
```

## 4. Data model (migration `0002`)

**Changed**

- `users.provider` CHECK: `provider IN ('github', 'google', 'dev')`.
- `documents.next_number INT NOT NULL DEFAULT 1`: the number the next version gets; incremented on every save and never decremented, so numbers are not reused after a delete.

**New** (InnoDB, utf8mb4, names from the naming convention, `DATETIME(6)` UTC timestamps as in 0001)

| Table | Columns | Keys |
| --- | --- | --- |
| `sessions` | `id` BIGINT AI, `token_hash` CHAR(64), `user_id` BIGINT, `created_at`, `expires_at` DATETIME(6) | PK `id`; unique `token_hash`; FK `user_id` → users CASCADE |
| `user_blobs` | `user_id` BIGINT, `hash` CHAR(64), `created_at` | PK `(user_id, hash)`; FK `user_id` → users CASCADE; FK `hash` → blobs RESTRICT; index on `hash` |
| `version_images` | `id` BIGINT AI, `version_id` BIGINT, `path` VARCHAR(1024), `hash` CHAR(64) | PK `id`; FK `version_id` → versions CASCADE; FK `hash` → blobs RESTRICT |

`version_images` has no unique key on `(version_id, path)`: 1024 utf8mb4 characters exceed InnoDB's 3072-byte index limit. The API rejects duplicate paths in one save instead.

`downgrade()` drops the three tables, the column and restores the old CHECK. The models stay the single source; `alembic check` passes after `0002`.

## 5. Authentication

### 5.1 Routes

| Route | Behaviour |
| --- | --- |
| `GET /api/auth/providers` | `{"providers": [...]}`: the enabled providers in the order github, google, dev |
| `GET /api/auth/login/{provider}?next=` | Stores state and PKCE verifier, redirects (302) to the provider; unknown or unconfigured provider → 404 |
| `GET /api/auth/callback/{provider}` | Verifies state, exchanges the code, upserts the user, creates a session, sets the cookie, redirects (302) to `next` |
| `POST /api/auth/logout` | Ends the current session, clears the cookie; 204 (also 204 without a session) |
| `GET /api/me` | `{id, provider, email, created_at}` |
| `DELETE /api/me` | Deletes the account (§7.4), clears the cookie; 204 |

`next` must start with `/` and not with `//` or `/\`, at most 2048 characters; anything else becomes `/`. It travels in the OAuth state cookie, not through the provider.

Callback failures (user denied, missing or wrong state, token exchange or profile fetch failed) never return JSON: they redirect to `/?login_error=<code>` with `code` one of `denied`, `state`, `provider`. Details go to the log without the code or tokens.

### 5.2 Providers

`services/oauth.py` defines:

```python
class Identity(NamedTuple):
    provider: str          # "github" | "google" | "dev"
    provider_user_id: str
    email: str | None

class IdentityProvider(Protocol):
    name: str
    def authorization_url(self, redirect_uri: str, state: str, code_verifier: str) -> str: ...
    def fetch_identity(self, redirect_uri: str, code: str, code_verifier: str) -> Identity: ...
```

- **GitHub** (Authlib OAuth 2 client): scopes `read:user user:email`; `provider_user_id` is `/user`'s numeric `id` as text; `email` is the primary verified address from `/user/emails`, else null.
- **Google** (Authlib, OpenID Connect discovery): scopes `openid email`; `provider_user_id` is `sub`; `email` only if `email_verified`.
- A provider is enabled when both `<NAME>_CLIENT_ID` and `<NAME>_CLIENT_SECRET` are set.
- The redirect URI is `PUBLIC_BASE_URL` + `/api/auth/callback/<name>`, never derived from request headers.
- PKCE (S256) for both.

**State cookie:** Starlette `SessionMiddleware` with cookie name `mdit_oauth`, `max_age=600`, `path="/api/auth"`, `same_site="lax"`, `https_only=COOKIE_SECURE`, signed with `SESSION_SECRET`. It holds only `{state, code_verifier, next}` for the login in progress and is cleared by the callback.

**Dev provider:** when `DEV_LOGIN=1`, `GET /api/auth/login/dev?name=<name>&next=` signs in immediately as `Identity("dev", name, None)` (no redirect to a provider). `name` is 1–64 characters of `[a-z0-9_-]`; otherwise 422. `create_app` logs a WARNING at startup while it is enabled. Compose enables it; Phase 6/7 manifests must not.

**User upsert:** on callback, find by `(provider, provider_user_id)`; create if missing; update `email` if it changed. The unique key handles two simultaneous first logins (retry the lookup on IntegrityError).

### 5.3 Sessions

- Token: `secrets.token_urlsafe(32)`; stored as `token_hash = sha256(token).hexdigest()`; never logged.
- Cookie `mdit_session`: the token, `HttpOnly`, `Secure` (unless `COOKIE_SECURE=false`), `SameSite=Lax`, `Path=/api`, `Max-Age = SESSION_DAYS × 86400`; `expires_at` matches. Fixed expiry, no sliding renewal.
- The cookie is not a signed payload (deviation from PRD §12's "signed"): an unguessable token looked up server-side cannot be forged, and logout and account delete revoke it for real. `SESSION_SECRET` signs the OAuth state cookie.
- `current_user` dependency: missing, unknown or expired token → 401 `unauthenticated`; an expired row is deleted when seen. A new login also deletes that user's expired sessions.
- Browsers accept `Secure` cookies on `http://localhost`, so Compose keeps `COOKIE_SECURE=true`; plain-HTTP LAN hosts need `false`.

### 5.4 CSRF

Every `POST`, `PUT`, `PATCH` and `DELETE` under `/api` requires the header `X-MdIt-CSRF: 1`, checked before authentication; missing or other value → 403 `csrf`. A browser cannot add a custom header to a cross-origin request without a CORS preflight, and the API sends no CORS headers; with `SameSite=Lax` this is OWASP's custom-request-header defence. `GET`, `HEAD` and the OAuth redirects are safe methods and change nothing except the callback, which is protected by `state`.

## 6. API

### 6.1 Rules

- Every route except `/api/health*`, `/api/auth/providers`, `/api/auth/login/*` and `/api/auth/callback/*` requires a session (401). Logout works without one.
- Every query joins through the current user. Another user's resource is **404**, not 403, so existence never leaks.
- IDs are `public_id`s. Timestamps are ISO 8601 UTC.
- Request/response models live in `app/schemas/`; every route has an explicit `response_model`, a stable `operation_id` (e.g. `listProjects`, `saveVersion`) and documented error responses, so 5b's `openapi-typescript` client is accurate.
- Errors use the Phase 4 shape `{"error": {"code", "message", "details"?}}`. New codes: `unauthenticated`, `csrf`, `version_conflict`, `blob_missing`, `hash_mismatch`, `unsupported_type`, `too_large`.
- No pagination (D5: unlimited retention).

### 6.2 Projects

| Route | Body | Result |
| --- | --- | --- |
| `GET /api/projects` | | 200 `[{id, name, created_at, document_count}]`, newest first |
| `POST /api/projects` | `{name}` (1–255 chars, trimmed) | 201 project |
| `PATCH /api/projects/{id}` | `{name}` | 200 project |
| `DELETE /api/projects/{id}` | | 204; cascades to documents, versions, version images; blobs stay owned by the user |

### 6.3 Documents

| Route | Body | Result |
| --- | --- | --- |
| `GET /api/projects/{id}/documents` | | 200 `[{id, path, created_at, latest: {id, number, created_at} \| null}]`, by path |
| `POST /api/projects/{id}/documents` | `{path}` | 201 document (`latest: null`) |
| `DELETE /api/documents/{id}` | | 204; cascades to its versions |

**Path rule** (documents and version images): 1–1024 characters, `/`-separated, no leading or trailing `/`, no empty, `.` or `..` segments, no `\` or control characters. Document paths end in `.md` (case-insensitive). Paths are not unique (P-049); the client keeps the local tree consistent.

### 6.4 Versions

| Route | Body | Result |
| --- | --- | --- |
| `GET /api/documents/{id}/versions` | | 200 `[{id, number, message, parent_id, created_at}]`, newest first |
| `POST /api/documents/{id}/versions` | `{parent_version_id, content_hash, message, path, images}` | 201 version detail |
| `GET /api/versions/{id}` | | 200 version detail |
| `DELETE /api/versions/{id}` | | 204 |

Version detail: summary fields plus `document_id`, `content_hash` and `images: [{path, hash}]`.

**Save** (`services/versions.py`, one transaction):

1. Validate the body: `parent_version_id` nullable; `message` optional, at most 500 characters (empty → null); `path` per §6.3; `images` at most 500 entries, paths per §6.3 without the `.md` rule, no duplicate paths (case-insensitive); hashes `^[0-9a-f]{64}$`.
2. `SELECT … FOR UPDATE` the document row through the user's project (404 if not found).
3. Latest = the remaining version with the highest number. If `parent_version_id` is not the latest's id (or not null when there is none) → **409** `version_conflict`, `details: {"latest": {id, number, created_at} | null}`.
4. Every hash (content and images) must be in the user's `user_blobs` → else **422** `blob_missing` with the missing hashes in `details`. The content blob's `content_type` must be `text/markdown` → else 422 `blob_missing`.
5. Insert the version with `number = next_number`, increment `next_number`, set `documents.path = path`, insert `version_images`, commit.

Two concurrent saves on the same parent: the row lock serializes them, so one gets 201 and the other 409.

**Delete:** removes the version and its `version_images`; its children's `parent_version_id` becomes NULL (P-049). Latest becomes the highest remaining number; a device whose head was the deleted version gets 409 on its next save and is offered "Load latest" (5b). Blobs stay owned.

### 6.5 Blobs

| Route | Result |
| --- | --- |
| `HEAD /api/blobs/{hash}` | 200 if the caller owns the blob, else 404 |
| `PUT /api/blobs/{hash}` | 201 created for this user, 200 already owned |
| `GET /api/blobs/{hash}` | 200 bytes if owned, else 404 |

**Upload checks** (`services/blobs.py`, in order):

1. `hash` matches `^[0-9a-f]{64}$` (else 404 from the path pattern).
2. `Content-Type` (parameters ignored) is one of `text/markdown`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml` → else 415 `unsupported_type`.
3. Body read in chunks; more than 5 MB (5 × 1024 × 1024 bytes) → 413 `too_large` (also when `Content-Length` says so up front).
4. SHA-256 of the bytes equals `hash` → else 422 `hash_mismatch`.
5. Content matches the type → else 415 `unsupported_type`: `text/markdown` decodes as UTF-8; PNG, JPEG, GIF, WebP by magic bytes; SVG parses as XML (defused: no DTDs or entities) with an `svg` root element.
6. If the `blobs` row is missing: put the bytes in Blob Storage (`BlobStore.put` keeps an existing object), then insert the row (`size`, `content_type`); a concurrent insert of the same hash is not an error. Then insert `user_blobs` if missing.

The server does not rewrite SVGs (deviation from PRD §12's "SVG sanitized", P-065): the app shows images only through `<img>` with object URLs, where SVG scripts never run, and a direct visit to the blob URL gets a sandboxed download.

**Download headers:** stored `Content-Type`, `Content-Length`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Content-Disposition: attachment`, `Cache-Control: private, max-age=31536000, immutable`. A blob row whose object is missing from storage → 500 (logged), never an empty body.

## 7. Services and behaviour

### 7.1 Transactions

Each request uses one SQLAlchemy session (the Phase 4 `get_session`); services commit once. Blob Storage writes happen before the database row that references them, so a row never points at a missing object; an object without a row is harmless (dedup reuses it, the later cleanup job removes it).

### 7.2 Logging

- An access-log filter on `uvicorn.access` replaces the query string of `/api/auth/callback/*` and `/api/auth/login/*` with `?…`, so OAuth codes, state and `next` never reach the logs.
- `create_db_engine` passes `hide_parameters=True`.
- Session tokens, cookies, OAuth tokens and document content are never logged. Auth failures log the provider and failure kind only.

### 7.3 Readiness (deferred from Phase 4)

The migrations check is ready when the database revision is the code's head **or a revision the code does not know** (a newer deploy has migrated ahead during a rolling update). It is unavailable when the revision is an older known one or missing.

### 7.4 Account deletion

`DELETE /api/me` in one transaction: collect the user's owned hashes; delete the user (cascades sessions, projects → documents → versions → version_images, user_blobs). Then, for each collected hash with no remaining `user_blobs` row and no `versions`/`version_images` reference: delete the Blob Storage object, then the `blobs` row. Storage deletes that fail are logged and left for the later cleanup job; the account is gone either way. Shared blobs another user owns are kept.

## 8. Compose and local development

- `backend` service: `PUBLIC_BASE_URL=http://localhost:8080`, `DEV_LOGIN=1`, `COOKIE_SECURE=true`, `SESSION_SECRET=${SESSION_SECRET}` and the four optional OAuth variables passed through from `.env`.
- `.env.example`: a `SESSION_SECRET` labelled “development only — generate your own for any shared deployment”, empty OAuth variables with a comment.
- README: how to register a GitHub OAuth app (callback `http://localhost:8080/api/auth/callback/github`) and a Google OAuth client (`…/callback/google`), and that `npm run dev` on :5173 works for the dev login (the Vite proxy forwards `/api`; cookies ignore ports) while real OAuth callbacks go to :8080 unless `PUBLIC_BASE_URL` is changed.
- Gateway (deferred from Phase 4): `resolver 127.0.0.11 valid=10s` and `proxy_pass` through variables, so a recreated backend or frontend is found without restarting the gateway.

## 9. Dependencies

Added (exact versions chosen and checked to be at least two weeks old while planning, recorded in `decisions.md` and `uv.lock`): Authlib, the `httpx` it needs for its client, `defusedxml` for the SVG check. A planning probe checks that Authlib's `httpx` and the dev-only `httpx2` coexist in one environment.

## 10. Configuration

New environment variables (P-052 style; secrets as `SecretStr`):

| Variable | Default | Notes |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | none (required) | e.g. `http://localhost:8080`; no trailing slash |
| `SESSION_SECRET` | none (required) | at least 32 characters |
| `SESSION_DAYS` | `30` | 1–365 |
| `COOKIE_SECURE` | `true` | |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | unset | both set → GitHub enabled |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | unset | both set → Google enabled |
| `DEV_LOGIN` | `false` | enables the `dev` provider |

Only one of a provider's pair set → settings error naming the missing variable (values hidden, P-056).

## 11. Testing

pytest on real MySQL 8.4 and Azurite (P-047); skipped locally when unreachable, required in CI.

- **Fake provider:** route tests register a fake `IdentityProvider` whose `authorization_url` points at a fixed URL and whose `fetch_identity` returns a set identity or raises.
- **Real providers:** GitHub and Google tested against mocked HTTP (token exchange, `/user`, `/user/emails`, Google discovery, id token / userinfo), including unverified and missing email.
- **Guard tests walk `app.routes`:** every route outside the allowlist returns 401 without a session (sending the CSRF header, since CSRF is checked first); every mutating route returns 403 without the CSRF header, with or without a session. A new route cannot skip either check.
- **Auth:** login redirect carries state and PKCE; callback with wrong state → `login_error=state`; denied → `denied`; `next` sanitizing; dev login on and off; logout invalidates the token; expired session → 401 and row deleted; cookie attributes.
- **Versions:** first save needs a null parent; save on the latest succeeds; stale parent → 409 with `latest`; two concurrent saves on one parent → exactly one 201 and one 409; numbers not reused after delete; deleting the latest makes the previous one latest; unowned or non-markdown content hash → 422; duplicate image paths → 422; path updates `documents.path`.
- **Blobs:** hash mismatch, wrong type, bad magic bytes, invalid UTF-8, SVG with a DTD, over 5 MB → rejected; dedup across users stores one object and two ownership rows; another user's HEAD/GET → 404; download headers.
- **Scoping:** every resource of user A is 404 for user B.
- **Account delete:** removes the user's data and Azurite objects nobody else owns, keeps shared ones, ends every session.
- **Migration 0002:** down and up (with try/finally), `alembic check`; readiness with a newer unknown revision → ready.
- **Phase 4 deferred:** error handler with a non-standard status code; skip message distinguishes unreachable from other connection errors.

## 12. CI

- `backend` job unchanged except setup-uv's `cache-dependency-glob: uv.lock` (relative to `working-directory`, deferred from Phase 4).
- `compose` job, after the existing checks, runs `scripts/api-smoke.sh http://localhost:8080`: curl with two cookie jars A and B, both dev-login as `smoke`; A creates a project and a document, uploads a Markdown blob and a PNG, saves version 1, then version 2 on parent 1; B lists projects and documents, fetches the latest version and both blobs and checks their SHA-256; a save on parent 1 → 409; `DELETE /api/me` → B's `GET /api/me` → 401. The script exits non-zero on any mismatch.

## 13. Acceptance

1. `docker compose up -d --build --wait` runs every service; `migrate` applies `0002`.
2. `scripts/api-smoke.sh` passes against the Compose stack, locally and in CI.
3. With `GITHUB_*` set to a real OAuth app, signing in through http://localhost:8080/api/auth/login/github ends at `/` with a session, and `/api/me` shows the account (manual, by the user).
4. `MDIT_REQUIRE_SERVICES=1 pytest` passes; ruff, ruff format and mypy strict are clean.
5. The guard tests cover every route in `app.routes`.
6. `/api/openapi.json` lists every route with an `operationId` and response models.
7. No log line from the test suite or the smoke run contains a session token, OAuth code or document content (checked by a test capturing logs during an auth and save flow).
8. CI is green on the PR; the frontend is unchanged.

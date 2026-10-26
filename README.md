# md.IT

A local-first technical writing workspace: Markdown editor, live preview, and a project/folder hierarchy, all in the browser. No account needed; signing in adds cloud version history (API in Phase 5a, the browser side in 5b).

- Product requirements: `PRD_v3_Technical_Markdown_Workspace (1).md`
- Progress log: `context.md`
- Decision log: `decisions.md`
- Specs and plans: `docs/superpowers/`

## Run it

Requirements: Node 22+, npm, Docker with Compose v2, and [uv](https://docs.astral.sh/uv/) for backend work (`pip install uv`, or the installer from the uv docs).

```bash
cd frontend
npm ci
npm run dev        # http://localhost:5173
npm test           # unit and component tests
npm run lint && npm run typecheck && npm run build
```

Container (same image as production):

```bash
docker build -t mdit-frontend frontend
docker run --rm -p 8080:80 mdit-frontend   # http://localhost:8080
```

Everything (MySQL, Azurite, migrations, backend, frontend and a gateway that routes `/api` the way the Kubernetes Ingress will):

```bash
docker compose up --build   # http://localhost:8080, API at http://localhost:8080/api/docs
docker compose down         # add -v to delete local server data
```

Defaults are for local development only; copy `.env.example` to `.env` to change them. MySQL is published on `127.0.0.1:3307`, because a locally installed MySQL often holds 3306.

Backend (from `backend/`; integration tests need `docker compose up -d --wait mysql azurite` and skip without it):

```bash
uv sync
uv run pytest
uv run ruff check . && uv run ruff format --check . && uv run mypy app
uv run alembic upgrade head   # needs DB_HOST, DB_PORT and DB_PASSWORD in the environment
```

`npm run dev` proxies `/api` to the backend on `127.0.0.1:8000`, so it works alongside `docker compose up`.

## Sign-in

Compose turns on a development-only login (`DEV_LOGIN=1`): open http://localhost:8080/api/auth/login/dev?name=you to sign in as dev user `you` (lowercase letters, digits, `_` and `-`). Never enable it outside local development.

Real GitHub or Google sign-in needs an OAuth app; set both of its values in `.env` and restart the backend (`docker compose up -d backend`):

- **GitHub:** Settings → Developer settings → OAuth Apps → New OAuth App. Homepage `http://localhost:8080`, callback `http://localhost:8080/api/auth/callback/github`. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, then open http://localhost:8080/api/auth/login/github.
- **Google:** Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web application), authorized redirect URI `http://localhost:8080/api/auth/callback/google`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then open http://localhost:8080/api/auth/login/google.

Callbacks go to `PUBLIC_BASE_URL` (default `http://localhost:8080`). The dev login also works under `npm run dev` on :5173, because the Vite proxy forwards `/api` and cookies ignore ports; real OAuth callbacks still land on :8080 unless you change `PUBLIC_BASE_URL` and the app's callback URL.

To try sync by hand, open http://localhost:8080 in two browser profiles (or a normal and a private window), sign in as the same dev user in both, save a version in one, and use **In your account → Download** in the other. The typed API client in `frontend/src/api/` is generated from the backend: after changing a route, run `cd backend && python -m uv run python ../scripts/export_openapi.py > ../frontend/src/api/openapi.json`, then `cd frontend && npm run api:types` (CI fails when either file is stale).

`python scripts/api_smoke.py http://localhost:8080` checks the whole version flow against a running stack: two cookie jars sign in as one dev user, one saves versions with an image, the other downloads them and checks their hashes, a stale save is refused, and deleting the account signs both out. CI runs it on every pull request.

## Status

Phase 1 (local editor) complete: projects, folders and documents stored in this browser; CodeMirror editor; live preview; split/editor/preview modes; autosave.

Phase 2 (technical rendering) complete: Mermaid diagrams, KaTeX math, highlighted code blocks with a copy button, and images stored in the project and shown in the tree (drop, paste or Insert image; `![alt](path){width=… align=…}`).

Phase 3 (customization and export) complete: rendering settings (font, letter spacing, line height, margin, padding), heading outline, document statistics, project search (Ctrl/Cmd+Shift+F), export as Markdown, self-contained HTML or PDF (print dialog), project export and import as .zip, and offline reload through a service worker.

Phase 4 (backend foundation) complete: FastAPI service with liveness (`/api/health`) and readiness (`/api/health/ready`) checks, MySQL 8.4 schema for users, projects, documents, versions and blobs under Alembic, a Blob Storage wrapper tested against Azurite, Docker Compose for the whole stack, and CI for both halves.

Phase 5a (login and versions API) complete: sign-in with GitHub, Google or a development-only dev login, server-side sessions in an httpOnly cookie, CSRF protection, and an API for projects, documents, per-document versions with conflict detection (409), content-addressed blobs owned per user, and account deletion. API docs at http://localhost:8080/api/docs.

Phase 5b (versions in the browser) built: an account control in the toolbar (sign in, sign out, delete account), **Save version** with an optional message (Ctrl/Cmd+Shift+S), a **History** tab listing a document's versions with a read-only viewer (Restore, Delete), a conflict dialog when another browser saved first (**Load latest** or **Save mine as a copy**), and an **In your account** section on the project list that downloads a cloud project into a new browser. Everything still works signed out or offline. See `context.md` for progress.

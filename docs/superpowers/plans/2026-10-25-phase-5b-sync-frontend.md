# Phase 5b — Login, versions and sync in the browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The md.IT frontend can sign in, save, list, open, restore and delete document versions, resolve conflicts, and download a cloud project on a new browser, using the merged 5a API.

**Architecture:** A generated, typed `api/` client (openapi-typescript types + openapi-fetch) is the only HTTP code. `auth/` holds session state in a React context; `sync/` runs the save/load/download flows over `api/` and `store/`. `app/` composes them into the toolbar, side panel, viewer and project list. Flows are tested end to end against an in-memory fake API served through an injected `fetch`.

**Tech Stack:** React 18.3, TypeScript 6.0, Vite 8, Vitest 5 + Testing Library + fake-indexeddb (jsdom 29), Dexie 4.4, openapi-fetch 0.17.0, openapi-typescript 7.13.0 (via npx), @noble/hashes.

**Spec:** `docs/superpowers/specs/2026-10-25-phase-5b-sync-frontend-design.md` (read it; this plan argues from it).

## Global Constraints

- Commands run from `frontend/` unless stated; the full gate per task: `npm run lint`, `npm run typecheck`, `npm test` all pass (417 existing tests keep passing); `npm run build` at Tasks 6, 8 and 9.
- Module rule (PRD §7): only `src/api/` imports `openapi-fetch`; only `src/auth/` and `src/sync/` import `src/api/`; only `src/store/` touches Dexie. `src/app/` composes.
- No new runtime dependency except `openapi-fetch@0.17.0` (exact pin `~0.17.0`). `openapi-typescript` is never installed; it runs as `npx --yes openapi-typescript@7.13.0`.
- Every mutating request carries `X-MdIt-CSRF: 1`; requests use `credentials: 'same-origin'`; no token is ever stored by the client.
- Design-system tokens and components only (P-013); voice: sentence case, verb-first, no exclamation marks; product name **md.IT**.
- Exact copy (from the spec):
  - Login errors:
    - denied: "Sign-in was cancelled."
    - state: "Sign-in took too long or started in another tab. Try again."
    - provider: "The provider couldn’t sign you in. Try again."
    - anything else: "Sign-in didn’t work. Try again."
  - Session ended: "Your session ended. Sign in again to save versions."
  - Save failure: "Couldn’t save a version: <message>. Your work is still saved in this browser."
  - Offline: "md.IT’s server can’t be reached."
  - Conflict dialog: title "A newer version exists"; text "Version N was saved from another browser or tab after this document was last saved or loaded. Load it, or save yours as a copy."; actions "Load latest", "Save mine as a copy", "Cancel".
  - Copy notice: "Saved your changes as “X copy.md”. “X.md” now has the latest version."
  - Restore and load notices: "Restored version N." / "Loaded version N.", plus " M images already in this project were kept." when M > 0.
  - History states: "Sign in to keep versions" / "Saved versions live in your md.IT account and open on any browser."; "No versions yet" / "Save version keeps a copy of this document in your account."; "Couldn’t load versions."
  - Delete account confirm: "Delete your account? Every saved version and image is removed from md.IT’s servers. Projects in this browser stay."
  - Download: "Downloaded N documents."; "Everything in your account is in this browser."; "Couldn’t load your account’s projects."
- Concurrency for blob transfers: at most 4 at a time.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; add a `context.md` log line in each task's commit (CLAUDE.md).

## Review Focus

1. **The session expires while the app is open** (30-day cookie, or the account was deleted from another browser), and then the user clicks Save version. Expected: notice "Your session ended. Sign in again to save versions.", the account control shows Sign in, and nothing local changes. Test: Task 6 `test_save_with_expired_session_signs_out`.
2. **A document renamed or moved after its first version.** Expected: the next save sends the new project-relative path, and the cloud document follows. Test: Task 4 `test_save_after_rename_sends_new_path`.
3. **The same image referenced twice, or through two different relative hrefs, in one document.** Expected: it is uploaded once and listed once in the version. Test: Task 4 `test_image_referenced_twice_is_sent_once`.
4. **Signing in from the workspace while an edit is still waiting for autosave.** Expected: the edit is written before the page leaves for the provider. Test: Task 6 `test_sign_in_flushes_the_draft_first`.
5. **Signing in from a URL with a query string** (e.g. a search). Expected: `next` keeps the path and query, so the user comes back to the same place. Test: Task 3 `test_login_url_keeps_path_and_query`.

---

### Task 1: Typed API client and generated schema

**Files:**
- Create: `scripts/export_openapi.py`, `frontend/src/api/openapi.json` (generated), `frontend/src/api/schema.d.ts` (generated), `frontend/src/api/client.ts`, `frontend/src/api/blobs.ts`, `frontend/src/api/index.ts`, `frontend/src/lib/sha256.ts`
- Modify: `frontend/package.json` (+ `openapi-fetch`, script `api:types`), `frontend/eslint.config.js` (ignore `src/api/schema.d.ts` if lint complains), `.github/workflows/ci.yml`
- Test: `frontend/src/api/client.test.ts`, `frontend/src/api/blobs.test.ts`, `frontend/src/lib/sha256.test.ts`

**Interfaces:**
- Produces from `api/index.ts`:
  - `type Api = Client<paths>`
  - `createApi(fetchImpl?: typeof fetch): Api`
  - `getApi(): Api`, a lazy singleton
  - `setApi(api: Api | null): void`, for tests
  - `class ApiError extends Error { status: number; code: string; details: unknown }`
  - `request<T>(run: () => Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T>`
  - `ensureBlob(api: Api, hash: string, bytes: ArrayBuffer, contentType: string): Promise<void>`
  - `getBlob(api: Api, hash: string): Promise<ArrayBuffer>`
  - schema aliases: `Me`, `ProjectOut`, `DocumentOut`, `LatestOut`, `VersionSummary`, `VersionDetail`, `ImageRef` (= `components['schemas'][...]`)
- Produces: `sha256Hex(data: ArrayBuffer | Uint8Array | string): string` in `lib/sha256.ts`. Strings are UTF-8 encoded. Uses `@noble/hashes`, because `crypto.subtle` is missing over plain HTTP (P-026).

- [ ] **Step 1: Export and generate.**
  - Write `scripts/export_openapi.py`. It builds `create_app(Settings(...))` with dummy values: `db_host="unused"`, `db_password="unused"`, `blob_connection_string="UseDevelopmentStorage=true"`, `public_base_url="http://localhost:8080"`, `session_secret="x"*32`. It prints `json.dumps(app.openapi(), indent=2, sort_keys=True)` with a trailing newline.
  - Run `cd ../backend && python -m uv run python ../scripts/export_openapi.py > ../frontend/src/api/openapi.json`.
  - Add `"api:types": "npx --yes openapi-typescript@7.13.0 src/api/openapi.json -o src/api/schema.d.ts"` and run it.
  - `npm i openapi-fetch@~0.17.0`.

- [ ] **Step 2: Write failing tests** (a hand-made `fetch` stub records `Request`s and answers from a list):

```ts
// client.test.ts
it('adds the CSRF header to mutating requests only', async () => { /* GET /api/projects → no header; POST /api/projects → 'x-mdit-csrf' === '1' */ });
it('sends same-origin credentials', ...);              // request.credentials === 'same-origin'
it('request() returns data on 2xx and undefined on 204', ...);
it('maps the error body to ApiError', async () => {    // 409 {"error":{"code":"version_conflict","message":"m","details":{"latest":null}}}
  await expect(request(...)).rejects.toMatchObject({ status: 409, code: 'version_conflict', details: { latest: null } });
});
it('falls back to http_<status> for a non-JSON error', ...);   // 502 text/html → code 'http_502'
it('maps a network failure to offline', ...);                 // fetch rejects TypeError → { status: 0, code: 'offline' }
// blobs.test.ts
it('skips the upload when HEAD finds the blob', ...);          // HEAD 200 → no PUT
it('uploads raw bytes with the content type after a 404', ...); // HEAD 404 → PUT body bytes, Content-Type image/png, CSRF header
it('getBlob returns the bytes', ...);
// sha256.test.ts
it('hashes strings as UTF-8', () => expect(sha256Hex('ü')).toBe('<sha256 of c3bc>'));
```

- [ ] **Step 3: Run** `npm test -- src/api src/lib/sha256` → FAIL (modules missing).

- [ ] **Step 4: Implement** to the interfaces.
  - `createApi` uses `baseUrl: window.location.origin`, so `Request` URLs are absolute under jsdom.
  - The CSRF middleware is an `onRequest` that sets the header unless the method is GET or HEAD.
  - `request()` wraps the call in try/catch: a thrown `TypeError` becomes `ApiError(0, 'offline', "md.IT’s server can’t be reached.")`.
  - `getBlob` uses `parseAs: 'arrayBuffer'`.
  - `PUT` passes `bodySerializer: (b) => b` with the `Content-Type` header.

- [ ] **Step 5: CI drift checks** (`.github/workflows/ci.yml`):
  - **backend job, after Tests** (the job's `working-directory` is already `backend`): `python -m uv run python ../scripts/export_openapi.py > ../frontend/src/api/openapi.json && git diff --exit-code -- ../frontend/src/api/openapi.json`.
  - **frontend job, after `npm ci`:** `npm run api:types && git diff --exit-code -- src/api/schema.d.ts`.
  - The frontend path filter adds `'scripts/export_openapi.py'`.
  - Check with `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -no-color .github/workflows/ci.yml`.

- [ ] **Step 6: Run** the gate (lint, typecheck, test) → PASS. Re-run both generators and confirm `git diff` is empty.

- [ ] **Step 7: Commit** `feat(frontend): typed API client generated from the backend's OpenAPI`.

---

### Task 2: Store support for cloud links

**Files:**
- Create: `frontend/src/store/cloud.ts`, `frontend/src/paths/usedImages.ts`
- Modify: `frontend/src/store/importProject.ts`, `frontend/src/store/types.ts` (`ProjectImportData` optional cloud fields), `frontend/src/store/index.ts`, `frontend/src/paths/index.ts`, `frontend/src/export/html.ts` (use `usedImageIds`)
- Test: `frontend/src/store/cloud.test.ts`, `frontend/src/store/importProject.test.ts` (extend), `frontend/src/paths/usedImages.test.ts`

**Interfaces:**
- `store/cloud.ts` (spec §7):
  - `linkProject(projectId: string, cloudProjectId: string | null): Promise<void>`
  - `linkDocument(docId: string, link: { cloudDocumentId: string; headVersionId?: string } | null): Promise<void>`
  - `clearCloudLinks(projectId?: string): Promise<void>`: clears `cloudProjectId`, `cloudDocumentId` and `headVersionId`, and sets `dirty = true`. With no id it covers every project.
  - `recordVersionSaved(docId: string, saved: { cloudDocumentId: string; headVersionId: string; content: string }): Promise<{ dirty: boolean }>`
  - `writeVersionContent(docId: string, update: { content: string; headVersionId: string; dirty: boolean }): Promise<void>`
  - `setHeadVersion(docId: string, headVersionId: string | undefined, dirty: boolean): Promise<void>`
  - `placeImages(projectId: string, images: Array<{ path: string; bytes: ArrayBuffer; contentType: ImageType; sha256: string }>): Promise<{ added: number; kept: number }>`
- `ProjectImportData` gains `cloudProjectId?: string`, and each document gains `cloudDocumentId?: string`, `headVersionId?: string` and `dirty?: boolean`. `importProject` stores them; `dirty` defaults to `true`.
- `paths/usedImages.ts`: `usedImageIds(markdown: string, folderId: string | null, index: PathIndex): Set<string>`, moved from `export/html.ts`.

- [ ] **Step 1: Write failing tests:**

```ts
it('links and unlinks a project and a document', ...);
it('clearCloudLinks(projectId) clears only that project and marks its documents dirty', ...);
it('clearCloudLinks() clears every project', ...);
it('recordVersionSaved clears dirty when the content is unchanged', ...);   // → { dirty: false }
it('recordVersionSaved keeps dirty when the content changed meanwhile', ...); // saveDocumentContent('newer') first → { dirty: true }, head stored
it('writeVersionContent replaces content, head and dirty', ...);
it('placeImages adds missing images and their folders', ...);   // 'notes/images/a.png' → folders notes, images; image name a.png; bytes stored
it('placeImages keeps an image with the same hash', ...);       // { added: 0, kept: 0 }
it('placeImages keeps a different item at the same path', ...); // different bytes → kept: 1; a document named a.png → kept: 1
it('placeImages matches folder names case-insensitively', ...); // existing 'Notes' folder reused for 'notes/x.png'
it('importProject stores cloud ids and dirty', ...);
it('usedImageIds finds images through relative and ../ hrefs once each', ...);
```

- [ ] **Step 2: Run** `npm test -- src/store/cloud src/store/importProject src/paths/usedImages` → FAIL.

- [ ] **Step 3: Implement.**
  - Each function is one Dexie transaction over `hierarchyTables()`.
  - `placeImages` uses `findOrCreateFolder` semantics inside its transaction (reuse the guards' sibling-name helpers) and stores the bytes in `imageData`. The image name and type come from the last path segment via `checkImageFile`.
  - `export/html.ts` imports `usedImageIds`; its tests stay green.

- [ ] **Step 4: Run** the gate → PASS.

- [ ] **Step 5: Commit** `feat(frontend): store cloud links, version bookkeeping and image placement`.

---

### Task 3: Accounts — session state and sign-in URLs

**Files:**
- Create: `frontend/src/auth/AuthProvider.tsx`, `auth/useAuth.ts`, `auth/loginUrl.ts`, `auth/loginError.ts`, `auth/LoginErrorNotice.tsx`, `auth/index.ts`, `frontend/src/test/fakeApi.ts`
- Modify: `frontend/src/app/App.tsx` (wrap in `AuthProvider`, render `LoginErrorNotice`), `frontend/src/main.tsx` if the provider must sit inside the router
- Test: `auth/AuthProvider.test.tsx`, `auth/loginUrl.test.ts`, `auth/loginError.test.ts`, `test/fakeApi.test.ts`

**Interfaces:**
- `auth/useAuth.ts`:
  - `type AuthState = 'loading' | 'signed-out' | 'signed-in' | 'unavailable'`
  - `interface Auth { state; user: Me | null; providers: string[]; signIn(provider: string, opts?: { name?: string }): void; signOut(): Promise<void>; deleteAccount(): Promise<void>; sessionEnded(): void; refresh(): Promise<void> }`
  - `useAuth(): Auth`
- `AuthProvider({ children, assign?: (url: string) => void })`:
  - `assign` defaults to `window.location.assign`.
  - On mount it loads `/api/me` and `/api/auth/providers`: a 401 means `signed-out`, `offline` or a 5xx means `unavailable`.
  - On `visibilitychange` to visible after more than 5 minutes hidden, it calls `refresh()`.
  - `deleteAccount` calls `DELETE /api/me` and then sets `signed-out`. Clearing local links is the caller's job (Task 6), which keeps `auth/` out of the store.
- `loginUrl(provider: string, next: string, name?: string): string` returns `/api/auth/login/${provider}?next=${encodeURIComponent(next)}` plus `&name=` when a name is given.
- `DEV_NAME = /^[a-z0-9_-]{1,64}$/`
- `loginErrorMessage(code: string): string`, with the exact copy from Global Constraints.
- `LoginErrorNotice`: reads `login_error` from `useLocation()`, shows it in the existing `Notice` style (or a `Callout`) with a Dismiss button, and removes the parameter with `navigate({ search }, { replace: true })`.
- `test/fakeApi.ts`: `createFakeApi(): FakeApi`
  - `FakeApi` exposes `{ fetch: typeof fetch; signIn(name?: string): void; signOut(): void; offline: boolean; failNext(status: number, body?: unknown): void; projects; documents; versions; blobs; calls: Array<{ method: string; path: string }> }`.
  - In-memory implementations of every 5a route 5b uses: 401 without a session, 403 without the CSRF header on mutating routes, 409 with `details.latest`, version numbers from a per-document counter, blobs keyed by SHA-256 with HEAD 404 until PUT, `DELETE /api/me` clearing everything.
  - Routes match on `new URL(request.url).pathname`.

- [ ] **Step 1: Write failing tests:**

```ts
// loginUrl.test.ts
it('test_login_url_keeps_path_and_query', () =>             // Review Focus 5
  expect(loginUrl('github', '/p/1/d/2?q=x y')).toBe('/api/auth/login/github?next=%2Fp%2F1%2Fd%2F2%3Fq%3Dx%20y'));
it('adds the dev name', () => expect(loginUrl('dev', '/', 'alice')).toBe('/api/auth/login/dev?next=%2F&name=alice'));
// loginError.test.ts
it.each([['denied', 'Sign-in was cancelled.'], ['state', '…'], ['provider', '…'], ['nope', 'Sign-in didn’t work. Try again.']])(...);
// AuthProvider.test.tsx (with fakeApi via setApi(createApi(fake.fetch)))
it('starts loading, then signed-in with the user and providers', ...);
it('is signed-out on 401', ...);
it('is unavailable when the server can’t be reached', ...);
it('signIn navigates to the login URL with the current path', ...);   // assign spy gets loginUrl('github', '/p/1')
it('signOut posts logout and becomes signed-out', ...);
it('deleteAccount deletes and becomes signed-out', ...);
it('sessionEnded becomes signed-out', ...);
it('refreshes after the tab was hidden for more than 5 minutes', ...); // vi.useFakeTimers, visibilitychange
it('LoginErrorNotice shows the message and removes login_error from the address', ...);
// fakeApi.test.ts
it('rejects mutating calls without the CSRF header', ...);
it('numbers versions and answers 409 on a stale parent', ...);
```

- [ ] **Step 2: Run** `npm test -- src/auth src/test/fakeApi` → FAIL.

- [ ] **Step 3: Implement.**
  - The provider keeps state with `useState` and exposes the auth object through context.
  - `useAuth` throws outside the provider.
  - Wrap `App`'s routes in `AuthProvider`, inside `BrowserRouter`: check `main.tsx` and put the provider where `useLocation` works for `LoginErrorNotice`.
  - The existing App, Workspace and ProjectList tests must keep passing. Give them a signed-out fake API by default: `setApi` in `test/setup.ts` to a fake whose `/api/me` returns 401.

- [ ] **Step 4: Run** the gate → PASS.

- [ ] **Step 5: Commit** `feat(frontend): session state, sign-in URLs and login error notices`.

---

### Task 4: Save version flow

**Files:**
- Create: `frontend/src/sync/paths.ts`, `sync/saveVersion.ts`, `sync/index.ts`
- Test: `sync/paths.test.ts`, `sync/saveVersion.test.ts`

**Interfaces:**
- Consumes: Task 1 (`getApi`, `request`, `ensureBlob`, `ApiError`, the types), Task 2 (`linkProject`, `linkDocument`, `clearCloudLinks`, `recordVersionSaved`, `usedImageIds`), and `readProjectSnapshot` and `createPathIndex` (existing).
- `sync/paths.ts`:
  - `folderNames(folders: Folder[], folderId: string | null): string[]`
  - `documentPath(folders: Folder[], doc: MdDocument): string`
  - `imagePath(folders: Folder[], image: ImageAsset): string`
  - `referencedImages(snapshot: ProjectSnapshot, doc: MdDocument, text: string): ImageWithBytes[]`, one entry per image id.
- `sync/saveVersion.ts`:
  - `type SaveResult = { kind: 'saved'; version: VersionDetail; dirty: boolean } | { kind: 'conflict'; latest: LatestOut | null }`
  - `saveVersion(docId: string, text: string, message: string | null, api?: Api): Promise<SaveResult>`
  - It runs spec §6.2 steps 2–9. Step 1, flushing the draft, is the caller's job. It throws `ApiError` for anything other than 409 and the one handled stale-link 404.
  - Helper `pool<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void>` in `sync/pool.ts`, with limit 4.

- [ ] **Step 1: Write failing tests** (fake API, fake-indexeddb; set up a project with `notes/Plan.md` and `notes/images/a.png` via the store):

```ts
it('first save creates the cloud project and document and saves v1', ...);  // project.cloudProjectId, doc.cloudDocumentId, headVersionId set; fake has 1 version with parent null
it('second save uses the head as parent', ...);                             // number 2, parent_id = v1
it('uploads the content and referenced images once, skipping known blobs', ...); // second save: no PUT for unchanged blobs (HEAD only)
it('test_image_referenced_twice_is_sent_once', ...);   // Review Focus 3: ![](images/a.png) and ![](../notes/images/a.png) → images: [{ path: 'notes/images/a.png', … }] once
it('test_save_after_rename_sends_new_path', ...);      // Review Focus 2: renameDocument then save → POST body path 'notes/Renamed.md'
it('returns conflict with the latest on 409', ...);    // fake has v2 the client doesn't know → { kind: 'conflict', latest: { number: 2 } }, local head unchanged
it('relinks once when the cloud project is gone', ...); // fake projects cleared → new project + doc, v1 with parent null, links updated
it('a second 404 is an error', ...);                    // fake.failNext(404) twice → rejects ApiError 404
it('keeps dirty when the text changed during the save', ...); // saveDocumentContent('newer') inside an ensureBlob call → result.dirty true
it('sends the message, or null for blank', ...);
it('rejects with ApiError offline when the server is down', ...);
```

- [ ] **Step 2: Run** `npm test -- src/sync` → FAIL.

- [ ] **Step 3: Implement** to the interfaces. The content hash is `sha256Hex(text)`; the image hash is the stored `image.sha256`.

- [ ] **Step 4: Run** the gate → PASS.

- [ ] **Step 5: Commit** `feat(frontend): save versions with lazy cloud linking and blob dedup`.

---

### Task 5: Load, restore, copy and history operations

**Files:**
- Create: `frontend/src/sync/loadVersion.ts`, `sync/history.ts`, `sync/saveAsCopy.ts`
- Test: `sync/loadVersion.test.ts`, `sync/history.test.ts`, `sync/saveAsCopy.test.ts`

**Interfaces:**
- `loadVersion(docId: string, versionId: string, mode: { asLatest: true } | { asLatest: false; latestId: string }, api?: Api): Promise<{ number: number; keptImages: number }>`: spec §6.4 steps 1–3. The caller reloads the editor.
- `history.ts`:
  - `listVersions(docId: string, api?: Api): Promise<VersionSummary[] | null>`: null when the document isn't linked; a 404 clears the document's link and returns null.
  - `readVersion(versionId: string, api?: Api): Promise<{ version: VersionDetail; text: string }>`
  - `deleteVersion(docId: string, versionId: string, api?: Api): Promise<void>`: when `versionId` is the head, sets head to the new latest from `listVersions` (or undefined) and dirty = true (P-081).
- `saveAsCopy(docId: string, text: string, message: string | null, latest: LatestOut, api?: Api): Promise<{ copyId: string; copyTitle: string; originalTitle: string; number: number }>`, spec §6.3 Save mine as a copy:
  1. `duplicateDocument(docId)`, then `saveDocumentContent(copyId, text)`.
  2. `saveVersion(copyId, text, message)`.
  3. `loadVersion(docId, latest.id, { asLatest: true })`.

- [ ] **Step 1: Write failing tests:**

```ts
it('load latest writes the text, sets head, clears dirty', ...);
it('restore of an older version keeps head at the latest and marks dirty', ...);  // then saveVersion → number 3, parent = v2
it('adds missing images and reports kept ones', ...);   // local a.png with other bytes → keptImages 1
it('listVersions is null for an unlinked document', ...);
it('listVersions clears a stale link on 404 and returns null', ...);
it('deleting the head moves head to the new latest and marks dirty', ...);
it('deleting another version leaves head alone', ...);
it('save mine as a copy keeps my text in a new cloud document and loads the latest into the original', ...);
  // copy content = my text, copy has its own cloudDocumentId with v1; original content = latest text, head = latest, dirty false
```

- [ ] **Step 2: Run** `npm test -- src/sync` → FAIL for the new tests.

- [ ] **Step 3: Implement** to the interfaces (store calls from Task 2).

- [ ] **Step 4: Run** the gate → PASS.

- [ ] **Step 5: Commit** `feat(frontend): restore, load latest, save as copy and version deletion`.

---

### Task 6: Workspace — account control, Save version and conflicts

**Files:**
- Create: `frontend/src/app/AccountMenu.tsx`, `app/DevSignInDialog.tsx`, `app/SaveVersionDialog.tsx`, `app/ConflictDialog.tsx`, `app/useVersionActions.ts`
- Modify: `frontend/src/app/useDocumentDraft.ts` (`flush`, `reload`, `revision`), `app/DocumentArea.tsx` (Editor key `${docId}:${revision}`), `app/Workspace.tsx`, `app/ProjectList.tsx` (AccountMenu in toolbar), `app/app.css`
- Test: `app/AccountMenu.test.tsx`, `app/SaveVersionDialog.test.tsx`, `app/ConflictDialog.test.tsx`, `app/useDocumentDraft.test.ts` (extend), `app/Workspace.test.tsx` (extend)

**Interfaces:**
- `useDocumentDraft` adds:
  - `flush(): Promise<void>`: resolves when no pending or failed edit remains, and rejects if the write fails.
  - `reload(): void`: increments `revision` and re-reads the document.
  - `revision: number`.
  - `saveNow` stays as it is.
- `AccountMenu({ onBeforeLeave?: () => Promise<void>; onAccountDeleted?: () => void })`:
  - **Loading:** nothing.
  - **Signed out / unavailable:** a `Button` labelled "Sign in" opening a `Menu` of "Sign in with GitHub", "Sign in with Google" and "Sign in as a dev user…" (only for listed providers). Before `auth.signIn`, it awaits `onBeforeLeave`.
  - **Signed in:** a `MenuButton` with icon `user` and the label = email or `dev: <provider_user_id>`. Items: a disabled "Signed in with <Provider> as <email or name>", "Sign out", and "Delete account…" (danger), which opens a `ConfirmDialog` with the exact copy. On confirm: `auth.deleteAccount()`, then `clearCloudLinks()`, then `onAccountDeleted`.
- `DevSignInDialog`: a `TextFieldDialog`-style dialog with a "Name" field checked against `DEV_NAME` (error: "Use 1–64 lowercase letters, digits, _ or -.").
- `SaveVersionDialog({ onSave(message: string | null): Promise<void>; onClose })`: an optional "Message" field (max 500), a primary "Save version" button that reads "Saving…" while the save runs, and errors shown inline.
- `ConflictDialog({ latestNumber: number; onLoadLatest; onSaveCopy; onClose })` with the exact copy.
- `useVersionActions(…)` in Workspace returns `{ saveVersion(message), loadLatest(latest), saveCopy(message, latest), restore(versionId, latestId), remove(versionId), conflict, lastSaved }`. It wraps `draft.flush()`, the sync calls, `draft.reload()`, notices, the 401 path (`auth.sessionEnded()` plus the exact notice) and the offline and other errors (exact copy).
- `lastSaved` is the `{ number }` of the last saved or loaded version in this session. The status detail `v<n>` is shown only when known (my call: the head's number isn't stored locally).
- **Toolbar:** "Save version" `Button` (icon `cloud`) while `auth.state === 'signed-in' && docReady`. Ctrl/Cmd+Shift+S opens the dialog. `SaveStatus state="cloud"` (detail `v<n>` when known) while the open document's `dirty` is false and it has a `headVersionId`. The open document comes from `useDocuments(projectId)`.

- [ ] **Step 1: Write failing tests:**

```ts
// useDocumentDraft.test.ts
it('flush resolves after the pending edit is written', ...);
it('reload re-reads content and bumps revision', ...);
// AccountMenu.test.tsx
it('signed out: lists the server’s providers, dev asks for a valid name', ...);
it('signed in: names the account, signs out, deletes after confirm and clears cloud links', ...);
// SaveVersionDialog / ConflictDialog
it('sends null for a blank message and shows Saving…', ...);
it('shows the conflict copy with the version number and three actions', ...);
// Workspace.test.tsx (fake API)
it('shows Save version only when signed in', ...);
it('saves a version and shows Version saved · v1 until the next edit', ...);
it('Ctrl+Shift+S opens the save dialog', ...);
it('opens the conflict dialog on 409; Load latest replaces the editor text', ...);
it('Save mine as a copy opens the copy with the notice', ...);
it('test_save_with_expired_session_signs_out', ...);   // Review Focus 1: fake.signOut() then Save → notice, Sign in button, document unchanged
it('test_sign_in_flushes_the_draft_first', ...);       // Review Focus 4: type, then Sign in with GitHub before autosave → stored content has the edit before assign is called
it('reports an unreachable server when saving', ...);  // fake.offline = true
```

- [ ] **Step 2: Run** `npm test -- src/app` → FAIL for the new tests.

- [ ] **Step 3: Implement** to the interfaces. Styles go in `app.css`, using tokens only.

- [ ] **Step 4: Run** the gate plus `npm run build` → PASS.

- [ ] **Step 5: Commit** `feat(frontend): account menu, Save version and conflict resolution in the workspace`.

---

### Task 7: History panel and version viewer

**Files:**
- Create: `frontend/src/ui/VersionItem.tsx`, `frontend/src/app/HistoryPanel.tsx`, `app/VersionViewer.tsx`
- Modify: `frontend/src/ui/index.ts`, `ui/components.css` (`.md-version*` from the design-system bundle, plus button resets in the app-extensions block), `app/SidePanel.tsx` (tab `history`, prop `history: ReactNode`), `app/Workspace.tsx` (viewer state, analysis skips the `history` tab), `app/DocumentArea.tsx` (renders `VersionViewer` when viewing), `decisions.md` P-013 note
- Test: `ui/ui.test.tsx` (VersionItem), `app/HistoryPanel.test.tsx`, `app/VersionViewer.test.tsx`, `app/Workspace.test.tsx` (extend)

**Interfaces:**
- `VersionItem({ number, message, time, current, onClick })`, ported as a `<button type="button" class="md-version">` (P-083): `v<n>`, the message or "No message", the time, and a `Badge tone="accent"` reading "Current".
- `HistoryPanel({ docId: string | undefined; headVersionId: string | undefined; signedIn: boolean; refreshKey: number; onOpen(version: VersionSummary): void })`: the spec §6.5 states with exact copy; relative time via `formatRelativeTime(Date.parse(created_at))`.
- `VersionViewer({ version: VersionSummary; text: string; html: string; latestId: string; onRestore(): void; onDelete(): void; onClose(): void })`:
  - a header "Version N · read-only", with the message and time;
  - the rendered text in the existing `Preview` (with the document's render context);
  - `Button`s: Restore (primary), Delete (danger, with a `ConfirmDialog` "Delete version N? This can’t be undone."), Close.
- **Workspace:** `viewing: { version; text } | null`. Opening flushes the draft and loads `readVersion`; Restore calls `restore`, then closes and reloads; Delete calls `remove`, then closes; switching documents closes the viewer. `refreshKey` increments after every save, load, restore and delete.

- [ ] **Step 1: Write failing tests:**

```ts
it('VersionItem is a button showing v3, the message and Current', ...);
it('history: signed out, unlinked, loading, error and list states', ...);
it('lists versions newest first and marks the head current', ...);
it('opening a version shows it read-only; Restore puts its text in the editor and marks dirty', ...);
it('Delete asks, then removes the version and refreshes the list', ...);
it('switching documents closes the viewer', ...);
```

- [ ] **Step 2: Run** `npm test -- src/ui src/app` → FAIL for the new tests.

- [ ] **Step 3: Implement** to the interfaces.

- [ ] **Step 4: Run** the gate → PASS.

- [ ] **Step 5: Commit** `feat(frontend): history panel and read-only version viewer`.

---

### Task 8: New device — download a cloud project

**Files:**
- Create: `frontend/src/sync/download.ts`, `frontend/src/app/CloudProjects.tsx`
- Modify: `frontend/src/app/ProjectList.tsx`, `app/app.css`
- Test: `sync/download.test.ts`, `app/CloudProjects.test.tsx`

**Interfaces:**
- `listCloudProjects(api?: Api): Promise<ProjectOut[]>`
- `downloadProject(cloudProjectId: string, api?: Api): Promise<{ projectId: string; documents: number; skipped: string[] }>`, spec §6.6:
  - Folders come from paths: every prefix of every document and image path, parents first.
  - The first document claiming a path wins; later ones are skipped as "<path> (a document with this name is already there)".
  - An image whose path is taken is skipped as "<path> (another file has this name)".
  - Documents without a latest version are skipped silently.
  - Blob downloads run 4 at a time.
- `CloudProjects({ onDownloaded(projectId: string, notice: string): void })`: shown while signed in.
  - Uses `useProjectSummaries()` to hide linked projects.
  - Rows: the name, "N documents · saved <relative time>" (from `created_at`; my call: the project's creation time, since there is no project-level updated time), and a Download `Button` that reads "Downloading…" while busy.
  - Empty and error states use the exact copy.
- `ProjectList` opens the downloaded project and shows the notice: "Downloaded N documents." plus " Skipped: a, b." when needed.

- [ ] **Step 1: Write failing tests:**

```ts
it('downloads latest versions into a new linked project with folders and images', ...);  // cloud ids, head = latest, dirty false, image bytes
it('skips documents without versions', ...);
it('reports clashing paths instead of overwriting', ...);  // two cloud docs 'a.md' and 'A.md' → second skipped
it('the section hides projects already in this browser and shows the empty copy', ...);
it('Download opens the project with the notice', ...);
it('shows the error copy when the list can’t load', ...);
```

- [ ] **Step 2: Run** `npm test -- src/sync/download src/app/CloudProjects` → FAIL.

- [ ] **Step 3: Implement** to the interfaces (`importProject` with cloud fields from Task 2).

- [ ] **Step 4: Run** the gate plus `npm run build` → PASS.

- [ ] **Step 5: Commit** `feat(frontend): download a cloud project on a new browser`.

---

### Task 9: Verification in real browsers, README and wrap-up

**Files:**
- Modify: `README.md` (Phase 5b status; how to try sync with two browser profiles), `context.md`
- Create (scratchpad only, not committed): a Playwright script driving headless Edge (`channel: 'msedge'`)

- [ ] **Step 1: Clean checks.** In `frontend/`: `npm ci`, `npm run api:types` with no diff, lint, typecheck, `npm test` (record the count), `npm run build`. In `backend/`: `MDIT_REQUIRE_SERVICES=1 python -m uv run pytest -q` → 308 passed (the backend is unchanged).

- [ ] **Step 2: Stack.** `docker compose up -d --build --wait`, then `python scripts/api_smoke.py http://localhost:8080` → passed.

- [ ] **Step 3: Browsers.** The Playwright script uses two browser contexts, A and B, on http://localhost:8080 and checks spec §12 items 1–11:
  - signed-out state;
  - dev sign-in through the menu (name `e2e-<random>`) returns to the same page;
  - save v1, then v2 with an image, with "Version saved · v2" showing;
  - B downloads from "In your account", and the tree, text and image match;
  - the conflict flow both ways;
  - restore v1, then save → v3;
  - delete a version;
  - `?login_error=denied` shows the notice and the address loses it;
  - backend stopped (`docker compose stop backend`): editing still autosaves and Save version reports the server can't be reached; then `docker compose start backend`;
  - delete the account → both A and B are signed out.

  Record any console errors. There must be none from the app or the CSP.

- [ ] **Step 4: README and context.** Update the README status and add a short "Try sync" note. Update `context.md`: Current state, checklist ("5b built — final review next") and the log line with counts and every browser result.

- [ ] **Step 5: Commit** `docs: Phase 5b verification`.

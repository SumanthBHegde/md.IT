# Phase 5b — Login, versions and sync in the browser: design

Status: written 2026-10-25 without a question round (the user asked to start directly); every choice below is the implementer's call, recorded in `decisions.md` (P-075…P-083) · Branch: `phase-5b-sync-frontend` · PRD: §6, §7, §7.1, §12, §13, §14 items 7–10 · Builds on the merged 5a API (PR #5)

## 1. Goal

The browser half of PRD Phase 5. After 5b a person can:

- sign in with GitHub, Google or (in development) a dev user, see who they are, sign out and delete their account
- save a version of a document with an optional message, see its history, open any version read-only, restore one into the working copy and delete one
- get a clear choice when another device saved first: **Load latest** or **Save mine as a copy**
- open md.IT on a new browser, sign in, and download a project's latest versions, images included

Local work never depends on the server: everything keeps working signed out or offline, and signing in or out changes nothing stored in the browser (PRD §6.1).

**Done when** (PRD §13): in two real browser profiles against the Compose stack, a version saved in one is downloaded and opened in the other, a conflicting save is caught and both resolutions work, and deleting the account signs both out. CI is green. Every item in §12 passes.

**Out of scope:** version diff and pruning (D5, Phase 8); merging; syncing rendering settings (D6: they stay local); renaming or deleting a cloud project from the UI (the API has them; YAGNI); keeping a downloaded project up to date beyond per-document history (each document's History panel loads the latest); background or automatic sync (autosave never creates versions, PRD §6.2); the 5a and earlier deferred minors.

## 2. Decisions this spec depends on

- **P-075** 5b runs on its own branch `phase-5b-sync-frontend` from `main` after PR #5 merged (amends P-057's single branch name), designed without a question round at the user's request.
- **P-076** The typed client: the backend's OpenAPI document is exported to `frontend/src/api/openapi.json` (committed) by `scripts/export_openapi.py`; `openapi-typescript` 7.13.0, run pinned through `npx` (its TypeScript 5 peer range conflicts with our TypeScript 6, P-014), generates `src/api/schema.d.ts` (committed); `openapi-fetch` 0.17.0 is the runtime client. CI fails when either generated file is stale.
- **P-077** Account UI: an account control at the right of both toolbars; sign-in is a full-page navigation to `/api/auth/login/{provider}?next=<current path>`; the dev provider asks for a name first; `?login_error=` on return becomes a notice and is removed from the address.
- **P-078** Saving: a local project links to a cloud project, and a document to a cloud document, on its first saved version (PRD §6.2); a 404 on a stale link (another account, or deleted elsewhere) clears the link and saves again once as a first version; `dirty` follows the rules in §6.2.
- **P-079** Restore and load write the version's text into the working copy and add its missing images at their paths; an image already at that path with different bytes is kept and the user is told.
- **P-080** Conflicts: 409 opens a dialog with **Load latest** and **Save mine as a copy**; the copy is a new document next to the original holding the user's text, saved as its own first version, and the original then loads the latest.
- **P-081** History is a fourth tab of the side panel (Outline · Stats · Settings · History) using `VersionItem`; opening a version shows it read-only in place of the editor and preview with **Restore**, **Delete** and **Close**.
- **P-082** New device: the project list gets an "In your account" section listing cloud projects not yet in this browser, each with **Download**; documents without versions are skipped, and clashing paths are reported, never overwritten.
- **P-083** `VersionItem` is ported from the design system as a `<button>` (the bundle renders a focusable `<div>`), added to P-013's extension list.

Unchanged: P-005 (React state + Dexie), P-017 (store conventions), P-025 (rendering), P-064 (CSRF header), P-065 (blobs are sandboxed downloads; images reach the page only as object URLs).

## 3. Repository layout (new and changed)

```
scripts/export_openapi.py              writes the backend OpenAPI document (sorted, stable)
frontend/
  package.json                         + openapi-fetch; scripts api:types
  src/api/
    openapi.json  schema.d.ts          generated, committed
    client.ts                          createApi(): openapi-fetch + CSRF + same-origin; ApiError
    blobs.ts                           ensureBlob (HEAD then PUT), getBlob
    index.ts
  src/auth/
    AuthProvider.tsx  useAuth.ts       session state, providers, sign in/out, delete account
    AccountMenu.tsx                    toolbar control; DevSignInDialog; DeleteAccountDialog
    loginError.ts                      ?login_error= → message
  src/sync/
    paths.ts                           project-relative paths of documents and images
    saveVersion.ts                     save flow (§6.2), conflict result
    loadVersion.ts                     restore / load latest (§6.4)
    download.ts                        new-device download (§6.6)
    HistoryPanel.tsx  VersionViewer.tsx  SaveVersionDialog.tsx  ConflictDialog.tsx
    CloudProjects.tsx                  "In your account" section
    index.ts
  src/paths/usedImages.ts              image ids a document resolves (moved out of export/html.ts)
  src/store/cloud.ts                   cloud links, version bookkeeping, writing images at paths
  src/store/importProject.ts           + optional cloud ids
  src/ui/VersionItem.tsx               ported (P-083)
  src/app/                             Workspace, SidePanel, DocumentArea, ProjectList, App, useDocumentDraft
.github/workflows/ci.yml               OpenAPI and schema drift checks
```

Module rule (PRD §7): only `api/` imports `openapi-fetch`; only `auth/` and `sync/` call `api/`; only `store/` touches IndexedDB. UI under `app/` uses `auth/` and `sync/`.

## 4. API client (`api/`)

- `createApi(fetchImpl = fetch)` returns an `openapi-fetch` client for `paths` with `baseUrl: window.location.origin` and `credentials: 'same-origin'`. A middleware adds `X-MdIt-CSRF: 1` to every method except GET and HEAD.
- `class ApiError extends Error { status: number; code: string; details: unknown }`. `status: 0, code: 'offline'` when `fetch` itself fails. Otherwise it reads the standard error body and falls back to `http_<status>`.
- `unwrap(result)` returns `data` or throws `ApiError`. Callers never see raw responses, except for 409, which `saveVersion` inspects.
- `ensureBlob(api, hash, bytes, contentType)`: `HEAD /api/blobs/{hash}`; on 404, `PUT` the raw bytes. `getBlob(api, hash): ArrayBuffer`.
- The whole app shares one client from `api/index.ts`, and tests inject a fake `fetch`.
- **Generation:**
  - `scripts/export_openapi.py` builds the app with dummy settings and prints `json.dumps(app.openapi(), indent=2, sort_keys=True)`. It runs as `cd backend && python -m uv run python ../scripts/export_openapi.py > ../frontend/src/api/openapi.json`.
  - `npm run api:types` runs `npx --yes openapi-typescript@7.13.0 src/api/openapi.json -o src/api/schema.d.ts`.
  - CI's backend job re-exports the document and fails on a diff, and its frontend job regenerates the types and fails on a diff.

## 5. Accounts (`auth/`)

**State:** `useAuth()` returns `{ state, user, providers, signIn, signOut, deleteAccount }`.
- `state` is one of:
  - `loading`;
  - `signed-out`;
  - `signed-in` (with `user` = `MeOut`);
  - `unavailable` (the server couldn't be reached; it behaves like signed out, and no error is shown until the user tries a cloud action).
- `AuthProvider` loads `GET /api/me` and `GET /api/auth/providers` on mount. It re-checks `/api/me` when the tab becomes visible after being hidden for more than 5 minutes, so an expired session shows as signed out.
- A 401 from any cloud call sets `signed-out`, and the caller's notice reads: "Your session ended. Sign in again to save versions."

**Sign in:**
- The account control shows **Sign in** while signed out. It opens a menu with one item per provider, in the server's order:
  - "Sign in with GitHub";
  - "Sign in with Google";
  - "Sign in as a dev user…" (only when the server lists `dev`).
- Choosing a provider navigates the page to `/api/auth/login/{provider}?next=` followed by the current path and query, URL-encoded. The page leaves; the service worker already lets `/api/` navigations through.
- The dev item first opens a dialog with one field, "Name" (lowercase letters, digits, `_`, `-`, at most 64; validated before leaving the page), then navigates with `&name=`.

**Coming back:**
- `?login_error=denied|state|provider` shows a dismissible notice at the top of the page, then the parameter is removed with `history.replaceState`. The messages:
  - denied: "Sign-in was cancelled."
  - state: "Sign-in took too long or started in another tab. Try again."
  - provider: "The provider couldn’t sign you in. Try again."
  - anything else: "Sign-in didn’t work. Try again."

**Signed in:**
- The control becomes a menu button (icon `user`, label the email, or "dev: name"). Its items:
  - a disabled first item naming the account ("Signed in with GitHub as a@b.c");
  - **Sign out**;
  - **Delete account…**
- **Sign out** calls `POST /api/auth/logout` and sets `signed-out`. Local projects and their cloud links are untouched.
- **Delete account…** opens a danger confirm dialog: "Delete your account? Every saved version and image is removed from md.IT’s servers. Projects in this browser stay." Confirm calls `DELETE /api/me` and sets `signed-out`. Then every local project's and document's cloud ids and `headVersionId` are cleared; they now point at nothing. Documents are marked dirty.

The account control sits in the project list toolbar (before the theme menu) and in the workspace toolbar (after Save version, before the panel toggle).

## 6. Versions (`sync/`)

### 6.1 Paths

- A document's cloud path is its folder names joined with `/`, then its title: `notes/Plan.md`.
- An image's path is built the same way. Images referenced from a document are found by rendering the document with a probing render context, the same way HTML export does (`paths/usedImages.ts`, shared).

### 6.2 Save version

- **Where:** a **Save version** button (icon `cloud`) in the workspace toolbar, shown while signed in and a document is open. Ctrl/Cmd+Shift+S opens it too.
- **Dialog:** `SaveVersionDialog` has one optional field, "Message" (at most 500 characters), and a primary **Save version** button. While the save runs, the button reads "Saving…".

**Flow (`saveVersion(docId, text, message)`):**
1. Flush the autosave, so the stored content is `text`.
2. Read the project snapshot: folders, documents, images.
3. **Cloud project:** if `project.cloudProjectId` is missing, `POST /api/projects {name}` and store the id.
4. **Cloud document:** if `doc.cloudDocumentId` is missing, `POST …/documents {path}` and store the id, with no `headVersionId`.
5. **Blobs:** hash the UTF-8 bytes of `text` (SHA-256, `@noble/hashes`) and `ensureBlob(… 'text/markdown')`. For each referenced image, `ensureBlob(image.sha256, bytes, image.contentType)`, at most 4 at a time.
6. **Version:** `POST /api/documents/{id}/versions` with `{parent_version_id: doc.headVersionId ?? null, content_hash, message, path, images: [{path, hash}]}`.
7. **Stale link:** a 404 from step 3, 4 or 6 means the link points at a project or document this account can't see. Clear the project's and every document's cloud ids, then run steps 3–6 once more. A second 404 is an error.
8. **Conflict:** a 409 returns `{ kind: 'conflict', latest }`, with nothing stored.
9. **Success:** store `headVersionId` and the cloud document id. Set `dirty = false` only if the stored content still equals `text`; an edit typed during the save stays dirty.

**`dirty` rules:**
- true on every content save (already the case);
- false after a successful save of that exact text, or after **Load latest**;
- true after restoring an older version.

**Status:** `SaveStatus` shows `cloud` ("Version saved", detail "v3") while the open document isn't dirty. Otherwise it keeps the local states. A document with no versions never shows `cloud`.

**Errors:** "Couldn’t save a version: <message>. Your work is still saved in this browser." `offline` reads "md.IT’s server can’t be reached."

### 6.3 Conflicts

`ConflictDialog` opens on a 409:
- **Title:** "A newer version exists"
- **Text:** "Version N was saved from another browser or tab after this document was last saved or loaded. Load it, or save yours as a copy."
- **Actions:** **Load latest**, **Save mine as a copy**, **Cancel**.

**Load latest:**
- Asks nothing more, because the dialog already says what happens.
- Runs §6.4 with the latest version and `asLatest`. The user's unsaved text in this document is replaced; it can still be recovered by cancelling and copying it first.
- Notice: "Loaded version N."

**Save mine as a copy:**
1. Creates a local document next to the original, named like Duplicate (`<name> copy.md`), holding the user's current text.
2. Saves it as a version: a new cloud document whose first version has a null parent.
3. Loads the latest version into the original (§6.4).
4. Opens the copy, with the notice: "Saved your changes as “X copy.md”. “X.md” now has the latest version."

**Cancel** closes the dialog and leaves everything as it was.

### 6.4 Restore and load latest

`loadVersion(docId, versionId, { asLatest })`:
1. Fetch the version and its content blob, then each image blob, at most 4 at a time.
2. **Images:** for each image path, find or create its folders.
   - No item at that path: add the image.
   - An image with the same `sha256`: keep it.
   - An image with different bytes, or a document or folder with that name: keep the local item and count it as kept.
3. Flush the autosave, write the text into the document, and set `headVersionId`:
   - **Load latest:** this version's id, with `dirty = false`.
   - **Restore** of an older version: the latest version's id, taken from the history list, so the next save continues the line (linear history, PRD §6.3). `dirty = true`.
4. Reload the editor with the new content.
5. Notice: "Restored version N." or "Loaded version N." When images were kept, it adds: "M images already in this project were kept."

### 6.5 History panel

The fourth side-panel tab, **History** (P-081), on `paper-sunken`. Its states:
- **Signed out:** an `EmptyState` with icon `history`, "Sign in to keep versions", and the text "Saved versions live in your md.IT account and open on any browser."
- **Document never saved:** "No versions yet", with the text "Save version keeps a copy of this document in your account."
- **Loading:** busy.
- **Unreachable:** a `Callout` reading "Couldn’t load versions."
- **Otherwise:** a `VersionItem` per version, newest first, with the number, the message (or "No message") and a relative time. `current` marks `headVersionId`.

**Behaviour:**
- The list loads when the tab opens and after every save, restore, load or delete.
- Clicking a version opens it in `VersionViewer`, which replaces the editor and preview:
  - a header reading "Version N · read-only", with the message and time;
  - the version's text rendered like the preview (with the document's current local images);
  - the actions **Restore** (primary), **Delete** (danger, confirmed) and **Close**.
- **Delete** of the version `headVersionId` points at: after the delete, `headVersionId` becomes the new latest (or none), and the document is marked dirty.

### 6.6 New device

`CloudProjects` on the project list, shown while signed in, is the "In your account" section. It lists `GET /api/projects` entries whose id no local project has as its `cloudProjectId`. Each row shows the name, "N documents · saved <relative time>" and a **Download** button.

**Download (`downloadProject(cloudId)`):**
1. List the project's documents; skip those without a latest version.
2. For each remaining document, fetch its latest version, the content blob and each image blob.
3. Build `ProjectImportData`: folders from the paths, documents (text plus cloud ids, `headVersionId` = the latest, `dirty = false`) and images. The first image claiming a path wins.
4. Import it in one transaction as a new project with `cloudProjectId`.
5. Report what was skipped: documents whose path clashes with another document's, or with an image's; images whose path was already taken by another file.
6. Open the project. The notice reads "Downloaded N documents." and adds the skip report when there is one.

**Empty and failure states:**
- With nothing left to show, the section shows "Everything in your account is in this browser."
- If the list can't load, it shows "Couldn’t load your account’s projects."

## 7. Store (`store/cloud.ts`, `importProject.ts`)

No Dexie schema change: `cloudProjectId`, `cloudDocumentId`, `headVersionId` and `dirty` already exist (PRD §9.1).

- `linkProject(projectId, cloudProjectId: string | null)`
- `linkDocument(docId, link: { cloudDocumentId: string; headVersionId?: string } | null)`
- `clearCloudLinks(projectId?)`: all projects when no id is given. It clears cloud ids and `headVersionId`, and sets `dirty = true`.
- `recordVersionSaved(docId, { cloudDocumentId, headVersionId, content })`: `dirty = false` only if the stored content equals `content`.
- `writeVersionContent(docId, { content, headVersionId, dirty })`
- `setHeadVersion(docId, headVersionId: string | undefined, dirty: boolean)`
- `placeImages(projectId, images: Array<{ path: string; bytes: ArrayBuffer; contentType: ImageType; sha256: string }>): Promise<{ added: number; kept: number }>`. It runs in one transaction and finds or creates folders by name, so names follow P-008.
- `importProject` accepts optional `cloudProjectId`, and per document optional `cloudDocumentId`, `headVersionId` and `dirty`.

Each of these is one transaction and touches the project's `updatedAt`, except `setHeadVersion`, which changes nothing a person sees in the tree.

## 8. Workspace changes

- **`useDocumentDraft`:**
  - `flush(): Promise<void>` resolves once pending and failed edits are written. It is used before saving, restoring or loading.
  - `reload()` re-reads the document. The editor remounts under the key `docId:revision`.
- **Draft vs. viewer:** the draft keeps working while `VersionViewer` is open. The editor is unmounted, but no edit is pending, because opening a version flushes first.
- **Toolbar** (DS README layout): wordmark / project … view switch … Insert image, Export, `SaveStatus`, **Save version**, account control, panel toggle, theme.
- **Notices** reuse the workspace `Notice`.

## 9. Security and privacy

- The client never stores tokens: the session cookie is httpOnly and same-origin. `credentials: 'same-origin'` only.
- No new CSP sources: `connect-src 'self'` covers `/api`. Blob bytes become object URLs only through the existing image store.
- Downloaded SVGs are stored like local uploads and shown only through `<img>` (P-065).
- `next` is always a same-site path the app builds itself; the server checks it again (`safe_next`).
- Logs stay quiet: no document text or tokens in `console` output; errors log only the `ApiError` code and status.

## 10. Testing

- **Unit (Vitest, jsdom, fake-indexeddb):**
  - `api/client` (CSRF header on mutating methods only, error mapping, offline);
  - `ensureBlob` (HEAD 200 skips PUT);
  - `sync/paths` and `usedImages`;
  - store cloud functions (dirty rules, `placeImages` keep/add, clash cases, `importProject` cloud ids);
  - `loginError` messages.
- **A fake API (`test/fakeApi.ts`):** an in-memory implementation of the 5a routes 5b uses (projects, documents, versions with 409 and next number, blobs with ownership, `/api/me`, logout, delete), served through an injected `fetch`. Flow tests drive `saveVersion`, `loadVersion` and `downloadProject` end to end against it:
  - first save links project and document;
  - a second save uses the head;
  - an edit during a save stays dirty;
  - a 404 relinks once;
  - 409 → conflict;
  - Load latest and Save mine as a copy;
  - restore keeps head as latest and marks dirty;
  - images added and kept;
  - download builds the tree with cloud ids and skips clashes;
  - deleting the head version moves it.
- **Components (Testing Library):** `AccountMenu` (each state, dev dialog validation, delete confirm), `HistoryPanel` (each state, current badge, viewer actions), `SaveVersionDialog`, `ConflictDialog`, `CloudProjects`, `VersionItem`, Workspace wiring (Save version only when signed in, Ctrl/Cmd+Shift+S, cloud status).
- **Browsers (verification, Playwright with headless Edge against Compose, as in Phases 2–3):** two contexts run the done-when flow in §1, plus a login_error notice and an offline backend (stop it; the editor still saves locally, and Save version reports the server can't be reached).
- The existing 417 frontend tests keep passing. Lint, typecheck and build are clean.

## 11. CI

- **backend job:** after the tests, `python -m uv run python ../scripts/export_openapi.py > ../frontend/src/api/openapi.json` and `git diff --exit-code -- frontend/src/api/openapi.json`. The `frontend` path filter adds `scripts/export_openapi.py`; the backend filter already includes `scripts/**`.
- **frontend job:** `npm run api:types` and `git diff --exit-code -- src/api/schema.d.ts`, before lint.
- The compose job is unchanged; the API smoke still runs.

## 12. Acceptance

1. Signed out: no Save version button; History shows "Sign in to keep versions"; local editing, export and import work as before.
2. Dev sign-in through the account menu returns to the same page signed in; Sign out returns to signed out with every local project intact.
3. Save version (with and without a message) creates v1, then v2; the History tab lists both, newest first, with v2 current; `SaveStatus` shows "Version saved · v2" until the next edit.
4. A document with images saves them once (HEAD skips existing blobs) and restores them on another browser.
5. Second browser profile: sign in as the same user; "In your account" lists the project; Download recreates folders, documents and images; the document shows v2 as current.
6. Edit and save in profile B, then save in profile A: the conflict dialog appears; Load latest shows B's text; repeating with Save mine as a copy leaves A's text in "X copy.md" (its own v1) and B's text in "X.md".
7. Open v1 read-only, Restore: the editor shows v1's text, the document is dirty, and the next save becomes v3 with v2 as its parent.
8. Delete a version from the viewer: it leaves the list; deleting the current version moves current to the new latest.
9. Delete account from profile A: both profiles become signed out (B on its next call or visibility check); A's projects stay in the browser without cloud links; "In your account" is gone.
10. `?login_error=denied` shows "Sign-in was cancelled." and the address loses the parameter.
11. With the backend stopped, local editing and autosave still work, and Save version says the server can't be reached.
12. CI is green, including both drift checks. Frontend lint, typecheck, tests and build pass; the backend is unchanged except `scripts/export_openapi.py`.

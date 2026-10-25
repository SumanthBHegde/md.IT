/** An in-memory md.IT API (the 5a routes 5b uses), served through an injected fetch.
 *
 * One account; every "browser" sharing a FakeApi is signed in as it. Mirrors the server's
 * rules that 5b depends on: 401 without a session, 403 without the CSRF header, 409 with
 * `details.latest` on a stale parent, version numbers that are never reused, blobs that
 * must be uploaded (HEAD 404) before a version may use them.
 */
import { sha256Hex } from '../lib/sha256';

export interface FakeProject { id: string; name: string; created_at: string }
export interface FakeDocument { id: string; project_id: string; path: string; created_at: string; next_number: number }
export interface FakeVersion {
  id: string;
  document_id: string;
  number: number;
  parent_id: string | null;
  content_hash: string;
  message: string | null;
  created_at: string;
  images: Array<{ path: string; hash: string }>;
}
export interface FakeBlob { bytes: Uint8Array; content_type: string }
export interface FakeCall { method: string; path: string; body?: unknown }

export interface FakeApi {
  fetch: typeof fetch;
  /** Sign the account in (a dev user `name`). */
  signIn(name?: string): void;
  /** End the session (as an expired cookie or a delete from another browser would). */
  signOut(): void;
  /** When true, every call fails like a dead network. */
  offline: boolean;
  /** The next call answers with this status (and error body), once per call queued. */
  failNext(status: number, body?: unknown): void;
  providers: string[];
  projects: Map<string, FakeProject>;
  documents: Map<string, FakeDocument>;
  versions: Map<string, FakeVersion>;
  blobs: Map<string, FakeBlob>;
  calls: FakeCall[];
  /** Add a version as if another browser saved it (bypasses the session). */
  addVersion(documentId: string, text: string, options?: { message?: string; images?: Array<{ path: string; hash: string }> }): FakeVersion;
  /** Store bytes as a blob (as an upload from another browser would). */
  putBlob(bytes: Uint8Array, contentType: string): string;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function error(status: number, code: string, message: string, details?: unknown): Response {
  return json(status, { error: details === undefined ? { code, message } : { code, message, details } });
}

export function createFakeApi(): FakeApi {
  let counter = 0;
  let clock = Date.UTC(2026, 9, 1, 9, 0, 0);
  const nextId = (prefix: string) => `${prefix}-${String(++counter).padStart(4, '0')}-0000-4000-8000-000000000000`.slice(0, 36);
  const now = () => new Date((clock += 60_000)).toISOString();
  let user: { id: string; provider: string; email: string | null; created_at: string; name: string } | null = null;
  const failures: Array<{ status: number; body?: unknown }> = [];

  const fake: FakeApi = {
    fetch: undefined as unknown as typeof fetch,
    offline: false,
    providers: ['github', 'dev'],
    projects: new Map(),
    documents: new Map(),
    versions: new Map(),
    blobs: new Map(),
    calls: [],
    signIn(name = 'alice') {
      user = { id: 'u-0001-0000-4000-8000-000000000000', provider: 'dev', email: null, created_at: now(), name };
    },
    signOut() {
      user = null;
    },
    failNext(status, body) {
      failures.push({ status, body });
    },
    addVersion(documentId, text, options = {}) {
      const doc = fake.documents.get(documentId);
      if (!doc) throw new Error(`no document ${documentId}`);
      const hash = fake.putBlob(new TextEncoder().encode(text), 'text/markdown');
      const latest = latestOf(documentId);
      const version: FakeVersion = {
        id: nextId('v'), document_id: documentId, number: doc.next_number++, parent_id: latest?.id ?? null, content_hash: hash,
        message: options.message ?? null, created_at: now(), images: options.images ?? [],
      };
      fake.versions.set(version.id, version);
      return version;
    },
    putBlob(bytes, contentType) {
      const hash = sha256Hex(bytes);
      fake.blobs.set(hash, { bytes: new Uint8Array(bytes), content_type: contentType });
      return hash;
    },
  };

  const versionsOf = (documentId: string) =>
    [...fake.versions.values()].filter((v) => v.document_id === documentId).sort((a, b) => b.number - a.number);
  const latestOf = (documentId: string) => versionsOf(documentId)[0];
  const latestOut = (v: FakeVersion | undefined) => (v ? { id: v.id, number: v.number, created_at: v.created_at } : null);
  const summary = (v: FakeVersion) => ({ id: v.id, number: v.number, message: v.message, parent_id: v.parent_id, created_at: v.created_at });
  const detail = (v: FakeVersion) => ({ ...summary(v), document_id: v.document_id, content_hash: v.content_hash, images: v.images });
  const documentOut = (d: FakeDocument) => ({ id: d.id, path: d.path, created_at: d.created_at, latest: latestOut(latestOf(d.id)) });
  const projectOut = (p: FakeProject) => ({
    id: p.id, name: p.name, created_at: p.created_at,
    document_count: [...fake.documents.values()].filter((d) => d.project_id === p.id).length,
  });
  const notFound = () => error(404, 'not_found', 'Not found.');

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const text = method === 'GET' || method === 'HEAD' ? '' : await request.clone().text();
    const isJson = (request.headers.get('content-type') ?? '').includes('json');
    const body: unknown = isJson && text ? JSON.parse(text) : undefined;
    fake.calls.push({ method, path, body });

    const failure = failures.shift();
    if (failure) return failure.body === undefined ? new Response(null, { status: failure.status }) : json(failure.status, failure.body);
    if (MUTATING.has(method) && request.headers.get('x-mdit-csrf') !== '1') {
      return error(403, 'csrf', 'This request is missing its CSRF header.');
    }
    if (path === '/api/auth/providers' && method === 'GET') return json(200, { providers: fake.providers });
    if (path === '/api/auth/logout' && method === 'POST') {
      user = null;
      return new Response(null, { status: 204 });
    }
    if (!user) return error(401, 'unauthenticated', 'Sign in to continue.');

    if (path === '/api/me') {
      if (method === 'GET') return json(200, { id: user.id, provider: user.provider, email: user.email, created_at: user.created_at });
      if (method === 'DELETE') {
        for (const map of [fake.projects, fake.documents, fake.versions, fake.blobs]) map.clear();
        user = null;
        return new Response(null, { status: 204 });
      }
    }
    if (path === '/api/projects') {
      if (method === 'GET') return json(200, [...fake.projects.values()].reverse().map(projectOut));
      if (method === 'POST') {
        const project = { id: nextId('p'), name: String((body as { name: string }).name).trim(), created_at: now() };
        fake.projects.set(project.id, project);
        return json(201, projectOut(project));
      }
    }
    let m = /^\/api\/projects\/([^/]+)\/documents$/.exec(path);
    if (m) {
      const project = fake.projects.get(m[1]!);
      if (!project) return notFound();
      if (method === 'GET') {
        const docs = [...fake.documents.values()].filter((d) => d.project_id === project.id).sort((a, b) => a.path.localeCompare(b.path));
        return json(200, docs.map(documentOut));
      }
      if (method === 'POST') {
        const doc: FakeDocument = { id: nextId('d'), project_id: project.id, path: (body as { path: string }).path, created_at: now(), next_number: 1 };
        fake.documents.set(doc.id, doc);
        return json(201, documentOut(doc));
      }
    }
    m = /^\/api\/documents\/([^/]+)$/.exec(path);
    if (m && method === 'DELETE') {
      if (!fake.documents.delete(m[1]!)) return notFound();
      return new Response(null, { status: 204 });
    }
    m = /^\/api\/documents\/([^/]+)\/versions$/.exec(path);
    if (m) {
      const doc = fake.documents.get(m[1]!);
      if (!doc) return notFound();
      if (method === 'GET') return json(200, versionsOf(doc.id).map(summary));
      if (method === 'POST') {
        const input = body as { parent_version_id: string | null; content_hash: string; message?: string | null; path: string; images?: Array<{ path: string; hash: string }> };
        const latest = latestOf(doc.id);
        if (input.parent_version_id !== (latest?.id ?? null)) {
          return error(409, 'version_conflict', 'A newer version was saved. Load it or save yours as a copy.', { latest: latestOut(latest) });
        }
        const images = input.images ?? [];
        const missing = [input.content_hash, ...images.map((i) => i.hash)].filter((h) => !fake.blobs.has(h));
        if (missing.length > 0) return error(422, 'blob_missing', 'Upload these blobs first.', { missing: [...new Set(missing)].sort() });
        const message = input.message && input.message.trim() ? input.message : null;
        const version: FakeVersion = {
          id: nextId('v'), document_id: doc.id, number: doc.next_number++, parent_id: latest?.id ?? null, content_hash: input.content_hash,
          message, created_at: now(), images,
        };
        doc.path = input.path;
        fake.versions.set(version.id, version);
        return json(201, detail(version));
      }
    }
    m = /^\/api\/versions\/([^/]+)$/.exec(path);
    if (m) {
      const version = fake.versions.get(m[1]!);
      if (!version) return notFound();
      if (method === 'GET') return json(200, detail(version));
      if (method === 'DELETE') {
        fake.versions.delete(version.id);
        for (const v of fake.versions.values()) if (v.parent_id === version.id) v.parent_id = null;
        return new Response(null, { status: 204 });
      }
    }
    m = /^\/api\/blobs\/([^/]+)$/.exec(path);
    if (m) {
      const hash = m[1]!;
      const blob = fake.blobs.get(hash);
      if (method === 'HEAD') return new Response(null, { status: blob ? 200 : 404 });
      if (method === 'GET') return blob ? new Response(blob.bytes.slice().buffer as ArrayBuffer, { status: 200, headers: { 'Content-Type': blob.content_type } }) : notFound();
      if (method === 'PUT') {
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (sha256Hex(bytes) !== hash) return error(422, 'hash_mismatch', 'The content doesn’t match its hash.');
        const contentType = (request.headers.get('content-type') ?? '').split(';')[0]!.trim();
        const created = !blob;
        fake.blobs.set(hash, { bytes, content_type: contentType });
        return json(created ? 201 : 200, { hash, size: bytes.byteLength, content_type: contentType });
      }
    }
    return notFound();
  }

  fake.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (fake.offline) throw new TypeError('Failed to fetch');
    return handle(input instanceof Request ? input : new Request(input, init));
  }) as typeof fetch;
  return fake;
}

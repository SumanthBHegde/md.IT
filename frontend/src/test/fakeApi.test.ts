import { describe, expect, it } from 'vitest';
import { createFakeApi } from './fakeApi';

const post = (fake: ReturnType<typeof createFakeApi>, path: string, body: unknown, csrf = true) =>
  fake.fetch(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-MdIt-CSRF': '1' } : {}) },
    body: JSON.stringify(body),
  });

describe('fakeApi', () => {
  it('rejects mutating calls without the CSRF header', async () => {
    const fake = createFakeApi();
    fake.signIn();
    expect((await post(fake, '/api/projects', { name: 'N' }, false)).status).toBe(403);
    expect((await post(fake, '/api/projects', { name: 'N' })).status).toBe(201);
  });

  it('numbers versions and answers 409 on a stale parent', async () => {
    const fake = createFakeApi();
    fake.signIn();
    const project = await (await post(fake, '/api/projects', { name: 'N' })).json();
    const doc = await (await post(fake, `/api/projects/${project.id}/documents`, { path: 'a.md' })).json();
    const v1 = fake.addVersion(doc.id, '# one');
    const hash = fake.putBlob(new TextEncoder().encode('# two'), 'text/markdown');
    const body = { parent_version_id: v1.id, content_hash: hash, path: 'a.md' };
    expect((await (await post(fake, `/api/documents/${doc.id}/versions`, body)).json()).number).toBe(2);
    const stale = await post(fake, `/api/documents/${doc.id}/versions`, body);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.details.latest.number).toBe(2);
  });
});

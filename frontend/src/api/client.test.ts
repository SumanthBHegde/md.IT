import { describe, expect, it } from 'vitest';
import { json, stubFetch } from '../test/fetchStub';
import { ApiError, createApi, request } from './client';

describe('api client', () => {
  it('adds the CSRF header to mutating requests only', async () => {
    const { fetchImpl, seen } = stubFetch(json(200, []), json(201, { id: 'p', name: 'N', created_at: 'x', document_count: 0 }));
    const api = createApi(fetchImpl);
    await api.GET('/api/projects');
    await api.POST('/api/projects', { body: { name: 'N' } });
    expect(seen[0]!.headers.get('x-mdit-csrf')).toBeNull();
    expect(seen[1]!.headers.get('x-mdit-csrf')).toBe('1');
  });

  it('sends same-origin credentials to this origin', async () => {
    const { fetchImpl, seen } = stubFetch(json(200, []));
    await createApi(fetchImpl).GET('/api/projects');
    expect(seen[0]!.credentials).toBe('same-origin');
    expect(new URL(seen[0]!.url).origin).toBe(window.location.origin);
  });

  it('request() returns data on 2xx and undefined on 204', async () => {
    const { fetchImpl } = stubFetch(json(200, [{ id: 'p' }]), new Response(null, { status: 204 }));
    const api = createApi(fetchImpl);
    await expect(request(() => api.GET('/api/projects'))).resolves.toEqual([{ id: 'p' }]);
    await expect(request(() => api.POST('/api/auth/logout'))).resolves.toBeUndefined();
  });

  it('maps the error body to ApiError', async () => {
    const body = { error: { code: 'version_conflict', message: 'Newer.', details: { latest: null } } };
    const { fetchImpl } = stubFetch(json(409, body));
    const api = createApi(fetchImpl);
    const failure = request(() => api.GET('/api/projects'));
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 409, code: 'version_conflict', message: 'Newer.', details: { latest: null } });
  });

  it('falls back to http_<status> for a non-JSON error', async () => {
    const { fetchImpl } = stubFetch(new Response('<html>Oops</html>', { status: 500, headers: { 'Content-Type': 'text/html' } }));
    const api = createApi(fetchImpl);
    await expect(request(() => api.GET('/api/projects'))).rejects.toMatchObject({ status: 500, code: 'http_500' });
  });

  it.each([502, 503, 504])('a gateway %i with nothing behind it reads as unreachable', async (status) => {
    const { fetchImpl } = stubFetch(new Response('<html>Bad gateway</html>', { status, headers: { 'Content-Type': 'text/html' } }));
    const api = createApi(fetchImpl);
    await expect(request(() => api.GET('/api/projects'))).rejects.toMatchObject({
      status,
      code: 'unavailable',
      message: 'md.IT can’t reach the cloud.',
    });
  });

  it('maps a network failure to offline', async () => {
    const { fetchImpl } = stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const api = createApi(fetchImpl);
    await expect(request(() => api.GET('/api/projects'))).rejects.toMatchObject({
      status: 0,
      code: 'offline',
      message: 'md.IT can’t reach the cloud.',
    });
  });
});


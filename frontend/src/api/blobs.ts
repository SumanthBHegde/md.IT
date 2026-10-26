import { ApiError, request, type Api } from './client';

/** Make sure the server holds these bytes for this user: HEAD first, PUT only when missing (PRD 6.5). */
export async function ensureBlob(api: Api, hash: string, bytes: ArrayBuffer, contentType: string): Promise<void> {
  try {
    await request(() => api.HEAD('/api/blobs/{hash}', { params: { path: { hash } } }));
    return;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }
  await request(() =>
    api.PUT('/api/blobs/{hash}', {
      params: { path: { hash } },
      body: bytes as never,
      bodySerializer: (body: unknown) => body as BodyInit,
      headers: { 'Content-Type': contentType },
    }),
  );
}

export async function getBlob(api: Api, hash: string): Promise<ArrayBuffer> {
  return request(() => api.GET('/api/blobs/{hash}', { params: { path: { hash } }, parseAs: 'arrayBuffer' }));
}

import { describe, expect, it } from 'vitest';
import { ensureBlob, getBlob } from './blobs';
import { createApi } from './client';
import { json, stubFetch } from '../test/fetchStub';

const HASH = 'a'.repeat(64);

describe('blobs', () => {
  it('skips the upload when HEAD finds the blob', async () => {
    const { fetchImpl, seen } = stubFetch(new Response(null, { status: 200 }));
    await ensureBlob(createApi(fetchImpl), HASH, new Uint8Array([1, 2]).buffer, 'image/png');
    expect(seen.map((r) => r.method)).toEqual(['HEAD']);
  });

  it('uploads raw bytes with the content type after a 404', async () => {
    const { fetchImpl, seen } = stubFetch(
      new Response(null, { status: 404 }),
      json(201, { hash: HASH, size: 2, content_type: 'image/png' }),
    );
    await ensureBlob(createApi(fetchImpl), HASH, new Uint8Array([1, 2]).buffer, 'image/png');
    const put = seen[1]!;
    expect(put.method).toBe('PUT');
    expect(new URL(put.url).pathname).toBe(`/api/blobs/${HASH}`);
    expect(put.headers.get('content-type')).toBe('image/png');
    expect(put.headers.get('x-mdit-csrf')).toBe('1');
    expect(new Uint8Array(await put.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });

  it('getBlob returns the bytes', async () => {
    const { fetchImpl } = stubFetch(new Response(new Uint8Array([7, 8, 9]), { status: 200, headers: { 'Content-Type': 'image/png' } }));
    const bytes = await getBlob(createApi(fetchImpl), HASH);
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([7, 8, 9]));
  });
});

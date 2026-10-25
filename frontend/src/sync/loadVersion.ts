import { getApi, getBlob, request, type Api } from '../api';
import { sha256Hex } from '../lib/sha256';
import { getDocument, imageTypeOf, NotFoundError, placeImages, writeVersionContent, type PlacedImage } from '../store';
import { pool, TRANSFERS } from './pool';

export type LoadMode = { asLatest: true } | { asLatest: false; latestId: string };

/** Fetch a version's text and images. Shared by load/restore and the new-device download. */
export async function fetchVersion(versionId: string, api: Api) {
  const version = await request(() => api.GET('/api/versions/{version_id}', { params: { path: { version_id: versionId } } }));
  const text = new TextDecoder().decode(await getBlob(api, version.content_hash));
  const images: PlacedImage[] = [];
  let unknown = 0;
  await pool(version.images, TRANSFERS, async (ref) => {
    // The server checked the bytes when they were uploaded; the extension says which kind.
    const contentType = imageTypeOf(ref.path.split('/').pop() ?? '', '');
    if (!contentType) {
      unknown++;
      return;
    }
    const bytes = await getBlob(api, ref.hash);
    images.push({ path: ref.path, bytes, contentType, sha256: sha256Hex(bytes) });
  });
  return { version, text, images, unknown };
}

/** Put a version into the working copy (spec 5b 6.4, P-079). Load latest: head = this version,
 * clean. Restore an older one: head stays the latest (history stays linear), dirty. The caller
 * flushed the draft before, and reloads the editor after. */
export async function loadVersion(
  docId: string,
  versionId: string,
  mode: LoadMode,
  api: Api = getApi(),
): Promise<{ number: number; keptImages: number }> {
  const doc = await getDocument(docId);
  if (!doc) throw new NotFoundError('This document no longer exists.');
  const { version, text, images, unknown } = await fetchVersion(versionId, api);
  const { kept } = await placeImages(doc.projectId, images);
  await writeVersionContent(docId, {
    content: text,
    headVersionId: mode.asLatest ? version.id : mode.latestId,
    dirty: !mode.asLatest,
  });
  return { number: version.number, keptImages: kept + unknown };
}

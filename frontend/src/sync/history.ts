import { ApiError, getApi, getBlob, request, type Api, type VersionDetail, type VersionSummary } from '../api';
import { getDocument, NotFoundError, setHeadVersion } from '../store';

/** The document's versions, newest first; null when it was never saved or this account can't see it. */
export async function listVersions(docId: string, api: Api = getApi()): Promise<VersionSummary[] | null> {
  const doc = await getDocument(docId);
  if (!doc?.cloudDocumentId) return null;
  try {
    return await request(() =>
      api.GET('/api/documents/{document_id}/versions', { params: { path: { document_id: doc.cloudDocumentId! } } }),
    );
  } catch (error) {
    // Deleted elsewhere, or saved under another account. Looking must not unlink it: signing back
    // in to the right account finds the history again, and a real save handles a stale link (P-078).
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function readVersion(versionId: string, api: Api = getApi()): Promise<{ version: VersionDetail; text: string }> {
  const version = await request(() => api.GET('/api/versions/{version_id}', { params: { path: { version_id: versionId } } }));
  return { version, text: new TextDecoder().decode(await getBlob(api, version.content_hash)) };
}

/** Delete a version. If it was this copy's head, the head moves to the newest version *older*
 * than it (or none), never to one saved since on another device: the next save must still meet
 * that one as a conflict, not build on it unseen (P-088, final review I5). */
export async function deleteVersion(docId: string, versionId: string, api: Api = getApi()): Promise<void> {
  const before = await getDocument(docId);
  if (!before) throw new NotFoundError('This document no longer exists.');
  const versions = before.headVersionId === versionId ? await listVersions(docId, api) : null;
  await request(() => api.DELETE('/api/versions/{version_id}', { params: { path: { version_id: versionId } } }));
  if (versions === null) return;
  const deleted = versions.find((version) => version.id === versionId);
  const older = deleted ? versions.find((version) => version.number < deleted.number) : undefined;
  await setHeadVersion(docId, older?.id, true);
}

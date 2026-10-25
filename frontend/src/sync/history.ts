import { ApiError, getApi, getBlob, request, type Api, type VersionDetail, type VersionSummary } from '../api';
import { getDocument, linkDocument, NotFoundError, setHeadVersion } from '../store';

/** The document's versions, newest first; null when it was never saved (or its link went stale). */
export async function listVersions(docId: string, api: Api = getApi()): Promise<VersionSummary[] | null> {
  const doc = await getDocument(docId);
  if (!doc?.cloudDocumentId) return null;
  try {
    return await request(() =>
      api.GET('/api/documents/{document_id}/versions', { params: { path: { document_id: doc.cloudDocumentId! } } }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      // Deleted elsewhere, or saved under another account: the next save starts a new history.
      await linkDocument(docId, null);
      return null;
    }
    throw error;
  }
}

export async function readVersion(versionId: string, api: Api = getApi()): Promise<{ version: VersionDetail; text: string }> {
  const version = await request(() => api.GET('/api/versions/{version_id}', { params: { path: { version_id: versionId } } }));
  return { version, text: new TextDecoder().decode(await getBlob(api, version.content_hash)) };
}

/** Delete a version; if it was this copy's head, the head moves to the new latest (P-081). */
export async function deleteVersion(docId: string, versionId: string, api: Api = getApi()): Promise<void> {
  await request(() => api.DELETE('/api/versions/{version_id}', { params: { path: { version_id: versionId } } }));
  const doc = await getDocument(docId);
  if (!doc) throw new NotFoundError('This document no longer exists.');
  if (doc.headVersionId !== versionId) return;
  const remaining = await listVersions(docId, api);
  await setHeadVersion(docId, remaining?.[0]?.id, true);
}

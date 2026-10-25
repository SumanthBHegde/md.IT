import { ApiError, ensureBlob, getApi, request, type Api, type LatestOut, type VersionDetail } from '../api';
import { sha256Hex } from '../lib/sha256';
import { clearCloudLinks, getDocument, linkDocument, linkProject, readProjectSnapshot, recordVersionSaved, NotFoundError } from '../store';
import { documentPath, imagePath, referencedImages } from './paths';
import { pool, TRANSFERS } from './pool';

export type SaveResult =
  | { kind: 'saved'; version: VersionDetail; /** Still changed since: an edit landed while saving. */ dirty: boolean }
  | { kind: 'conflict'; latest: LatestOut | null };

/** A 404 from a cloud project or document link: it points at something this account can't see. */
class StaleLink extends Error {
  constructor(readonly cause: ApiError) {
    super(cause.message);
  }
}

async function linked<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw new StaleLink(error);
    throw error;
  }
}

async function attempt(docId: string, text: string, message: string | null, api: Api): Promise<SaveResult> {
  const found = await getDocument(docId);
  if (!found) throw new NotFoundError('This document no longer exists.');
  const snapshot = await readProjectSnapshot(found.projectId);
  const doc = snapshot?.documents.find((d) => d.id === docId);
  if (!snapshot || !doc) throw new NotFoundError('This document no longer exists.');
  const { project, folders } = snapshot;

  let cloudProjectId = project.cloudProjectId;
  if (!cloudProjectId) {
    const created = await linked(request(() => api.POST('/api/projects', { body: { name: project.name } })));
    cloudProjectId = created.id;
    await linkProject(project.id, cloudProjectId);
  }
  const path = documentPath(folders, doc);
  let cloudDocumentId = doc.cloudDocumentId;
  let parent = doc.headVersionId ?? null;
  if (!cloudDocumentId) {
    const created = await linked(
      request(() => api.POST('/api/projects/{project_id}/documents', { params: { path: { project_id: cloudProjectId! } }, body: { path } })),
    );
    cloudDocumentId = created.id;
    parent = null;
    await linkDocument(doc.id, { cloudDocumentId });
  }

  const content = new TextEncoder().encode(text);
  const contentHash = sha256Hex(content);
  await ensureBlob(api, contentHash, content.buffer as ArrayBuffer, 'text/markdown');
  const images = referencedImages(snapshot, doc, text);
  await pool(images, TRANSFERS, (image) => ensureBlob(api, image.sha256, image.bytes, image.contentType));

  let version: VersionDetail;
  try {
    version = await linked(
      request(() =>
        api.POST('/api/documents/{document_id}/versions', {
          params: { path: { document_id: cloudDocumentId! } },
          body: {
            parent_version_id: parent,
            content_hash: contentHash,
            message: message?.trim() ? message : null,
            path,
            images: images.map((image) => ({ path: imagePath(folders, image), hash: image.sha256 })),
          },
        }),
      ),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const details = error.details as { latest?: LatestOut | null } | undefined;
      return { kind: 'conflict', latest: details?.latest ?? null };
    }
    throw error;
  }
  const { dirty } = await recordVersionSaved(doc.id, { cloudDocumentId, headVersionId: version.id, content: text });
  return { kind: 'saved', version, dirty };
}

/** Save `text` as the document's next version (spec 5b 6.2, P-078). The caller flushes the
 * draft first, so the store already holds `text`. Throws ApiError for anything but a conflict. */
export async function saveVersion(docId: string, text: string, message: string | null, api: Api = getApi()): Promise<SaveResult> {
  try {
    return await attempt(docId, text, message, api);
  } catch (error) {
    if (!(error instanceof StaleLink)) throw error;
  }
  // Linked to a project or document this account can't see: start the cloud copy again, once.
  const doc = await getDocument(docId);
  if (doc) await clearCloudLinks(doc.projectId);
  try {
    return await attempt(docId, text, message, api);
  } catch (error) {
    throw error instanceof StaleLink ? error.cause : error;
  }
}

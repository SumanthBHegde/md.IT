import { db, now, ROOT, type FolderRow, type ImageRow } from './db';
import { hierarchyTables, requireDocument, requireProject, siblingNames, touchProject } from './guards';
import { newId } from './ids';
import { checkImageFile, withImageExtension } from './imageRules';
import { nameKey, normalizeName } from './names';
import type { ImageType } from './types';

/** Cloud bookkeeping for Phase 5b (P-078, P-079): which cloud project and document a local one
 * is linked to, which version it was last saved or loaded as, and whether it changed since. */

export async function linkProject(projectId: string, cloudProjectId: string | null): Promise<void> {
  await db.transaction('rw', db.projects, async () => {
    await requireProject(projectId);
    await db.projects.update(projectId, { cloudProjectId: cloudProjectId ?? undefined });
  });
}

export async function linkDocument(docId: string, link: { cloudDocumentId: string; headVersionId?: string } | null): Promise<void> {
  await db.transaction('rw', db.documents, async () => {
    await requireDocument(docId);
    await db.documents.update(docId, { cloudDocumentId: link?.cloudDocumentId, headVersionId: link?.headVersionId });
  });
}

/** Forget cloud links (one project, or every project): the documents count as changed again. */
export async function clearCloudLinks(projectId?: string): Promise<void> {
  await db.transaction('rw', db.projects, db.documents, async () => {
    const projects = projectId === undefined ? db.projects.toCollection() : db.projects.where('id').equals(projectId);
    await projects.modify((project) => {
      delete project.cloudProjectId;
    });
    const documents = projectId === undefined ? db.documents.toCollection() : db.documents.where('projectId').equals(projectId);
    await documents.modify((doc) => {
      delete doc.cloudDocumentId;
      delete doc.headVersionId;
      doc.dirty = true;
    });
  });
}

/** After a version is saved: clean only if the stored text is still the text that was saved. */
export async function recordVersionSaved(
  docId: string,
  saved: { cloudDocumentId: string; headVersionId: string; content: string },
): Promise<{ dirty: boolean }> {
  return db.transaction('rw', db.documents, async () => {
    const doc = await requireDocument(docId);
    const dirty = doc.content !== saved.content;
    await db.documents.update(docId, { cloudDocumentId: saved.cloudDocumentId, headVersionId: saved.headVersionId, dirty });
    return { dirty };
  });
}

export async function writeVersionContent(docId: string, update: { content: string; headVersionId: string; dirty: boolean }): Promise<void> {
  await db.transaction('rw', db.projects, db.documents, async () => {
    const doc = await requireDocument(docId);
    const at = now();
    await db.documents.update(docId, { ...update, updatedAt: at });
    await touchProject(doc.projectId, at);
  });
}

export async function setHeadVersion(docId: string, headVersionId: string | undefined, dirty: boolean): Promise<void> {
  await db.transaction('rw', db.documents, async () => {
    await requireDocument(docId);
    await db.documents.update(docId, { headVersionId, dirty });
  });
}

export interface PlacedImage {
  /** Project-relative, `/`-separated, e.g. `notes/images/a.png`. */
  path: string;
  bytes: ArrayBuffer;
  contentType: ImageType;
  sha256: string;
}

/** The folder for `segments` under the root, created as needed; null when another kind of item holds a name on the way. */
async function folderFor(projectId: string, segments: string[], at: number): Promise<string | null> {
  let parentKey = ROOT;
  for (const segment of segments) {
    const name = normalizeName(segment);
    const folders = await db.folders.where('[projectId+parentFolderId]').equals([projectId, parentKey]).toArray();
    const existing = folders.find((folder) => nameKey(folder.name) === nameKey(name));
    if (existing) {
      parentKey = existing.id;
      continue;
    }
    if ((await siblingNames(projectId, parentKey)).some((taken) => nameKey(taken) === nameKey(name))) return null;
    const row: FolderRow = { id: newId(), projectId, parentFolderId: parentKey, name, createdAt: at, updatedAt: at };
    await db.folders.add(row);
    parentKey = row.id;
  }
  return parentKey;
}

/** Put a version's images at their paths (P-079): missing ones are added; an item already
 * there is kept (same bytes silently, anything else counted in `kept`). One transaction. */
export async function placeImages(projectId: string, images: readonly PlacedImage[]): Promise<{ added: number; kept: number }> {
  return db.transaction('rw', hierarchyTables(), async () => {
    await requireProject(projectId);
    const at = now();
    let added = 0;
    let kept = 0;
    for (const image of images) {
      const segments = image.path.split('/');
      const fileName = segments.pop() ?? '';
      const folderKey = await folderFor(projectId, segments, at);
      if (folderKey === null) {
        kept++;
        continue;
      }
      const type = checkImageFile(fileName, image.contentType, image.bytes.byteLength);
      const name = withImageExtension(normalizeName(fileName), type);
      const sameName = (taken: string) => nameKey(taken) === nameKey(name);
      const images = await db.images.where('[projectId+folderId]').equals([projectId, folderKey]).toArray();
      const existing = images.find((row) => sameName(row.name));
      if (existing?.sha256 === image.sha256) continue;
      if (existing || (await siblingNames(projectId, folderKey)).some(sameName)) {
        kept++;
        continue;
      }
      const row: ImageRow = {
        id: newId(), projectId, folderId: folderKey, name, contentType: type, size: image.bytes.byteLength, sha256: image.sha256,
        createdAt: at, updatedAt: at,
      };
      await db.images.add(row);
      await db.imageData.add({ id: row.id, bytes: image.bytes });
      added++;
    }
    if (added > 0) await touchProject(projectId, at);
    return { added, kept };
  });
}


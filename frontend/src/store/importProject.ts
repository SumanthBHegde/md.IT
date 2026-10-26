import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { db, now, ROOT, type DocumentRow, type FolderRow, type ImageRow } from './db';
import { ValidationError } from './errors';
import { assertNameFree, hierarchyTables } from './guards';
import { newId } from './ids';
import { checkImageFile, withImageExtension } from './imageRules';
import { normalizeName, withMdExtension } from './names';
import type { Project, ProjectImportData } from './types';

/** Creates a new project from imported data in one transaction: all of it, or nothing (P-039). */
export async function importProject(data: ProjectImportData): Promise<Project> {
  const name = normalizeName(data.name);
  // crypto.subtle is missing on plain-HTTP pages, so hash in JS (P-026), before the transaction.
  const hashes = data.images.map((image) => bytesToHex(sha256(new Uint8Array(image.bytes))));
  return db.transaction('rw', hierarchyTables(), async () => {
    const at = now();
    const project: Project = { id: newId(), name, description: data.description, createdAt: at, updatedAt: at };
    if (data.cloudProjectId !== undefined) project.cloudProjectId = data.cloudProjectId;
    await db.projects.add(project);

    const folderIds = new Map<string, string>([['', ROOT]]);
    const taken = new Map<string, string[]>();
    const parentOf = (path: readonly string[]): string => {
      const id = folderIds.get(path.join('/'));
      if (id === undefined) throw new ValidationError(`The folder “${path.join('/')}” is missing from this import.`);
      return id;
    };
    const claim = (parent: string, itemName: string) => {
      const names = taken.get(parent) ?? [];
      assertNameFree(itemName, names);
      names.push(itemName);
      taken.set(parent, names);
    };

    for (const path of data.folders) {
      const parent = parentOf(path.slice(0, -1));
      const folderName = normalizeName(path[path.length - 1] ?? '');
      claim(parent, folderName);
      const row: FolderRow = { id: newId(), projectId: project.id, parentFolderId: parent, name: folderName, createdAt: at, updatedAt: at };
      await db.folders.add(row);
      folderIds.set(path.join('/'), row.id);
    }
    for (const doc of data.documents) {
      const folderId = parentOf(doc.folder);
      const title = withMdExtension(normalizeName(doc.title));
      claim(folderId, title);
      const row: DocumentRow = {
        id: newId(), projectId: project.id, folderId, title, content: doc.content, dirty: doc.dirty ?? true, createdAt: at, updatedAt: at,
      };
      if (doc.cloudDocumentId !== undefined) row.cloudDocumentId = doc.cloudDocumentId;
      if (doc.headVersionId !== undefined) row.headVersionId = doc.headVersionId;
      await db.documents.add(row);
    }
    for (const [i, image] of data.images.entries()) {
      const folderId = parentOf(image.folder);
      const type = checkImageFile(image.name, image.contentType, image.bytes.byteLength);
      const imageName = withImageExtension(normalizeName(image.name), type);
      claim(folderId, imageName);
      const row: ImageRow = {
        id: newId(), projectId: project.id, folderId, name: imageName, contentType: type, size: image.bytes.byteLength, sha256: hashes[i]!,
        createdAt: at, updatedAt: at,
      };
      await db.images.add(row);
      await db.imageData.add({ id: row.id, bytes: image.bytes });
    }
    return project;
  });
}

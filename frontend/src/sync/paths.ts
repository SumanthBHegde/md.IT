import { createPathIndex, usedImageIds } from '../paths';
import type { Folder, ImageAsset, ImageWithBytes, MdDocument, ProjectSnapshot } from '../store';

/** Folder names from the project root down to `folderId` (P-078: cloud paths are project-relative). */
export function folderNames(folders: readonly Folder[], folderId: string | null): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = folderId === null ? undefined : byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentFolderId === null ? undefined : byId.get(current.parentFolderId);
  }
  return names;
}

export function documentPath(folders: readonly Folder[], doc: MdDocument): string {
  return [...folderNames(folders, doc.folderId), doc.title].join('/');
}

export function imagePath(folders: readonly Folder[], image: ImageAsset): string {
  return [...folderNames(folders, image.folderId), image.name].join('/');
}

/** The stored images `text` (written in `doc`) shows, once each, as the preview resolves them. */
export function referencedImages(snapshot: ProjectSnapshot, doc: MdDocument, text: string): ImageWithBytes[] {
  const index = createPathIndex(snapshot.folders, snapshot.documents, snapshot.images);
  const ids = usedImageIds(text, doc.folderId, index);
  return snapshot.images.filter((image) => ids.has(image.id));
}

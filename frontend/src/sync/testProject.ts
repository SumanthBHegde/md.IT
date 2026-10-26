/** Test fixture shared by the sync tests: a project with `notes/Plan.md` and `notes/images/a.png`. */
import { sha256Hex } from '../lib/sha256';
import { addImage, createDocument, createFolder, createProject, saveDocumentContent } from '../store';

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).buffer;
export const PNG_HASH = sha256Hex(PNG);
export const TEXT = '# Plan\n\n![dot](images/a.png)\n';

export async function makeProject(text: string = TEXT) {
  const project = await createProject('Notes');
  const notes = await createFolder(project.id, null, 'notes');
  const images = await createFolder(project.id, notes.id, 'images');
  const image = await addImage(project.id, images.id, { name: 'a.png', type: 'image/png', bytes: PNG });
  const doc = await createDocument(project.id, notes.id, 'Plan');
  await saveDocumentContent(doc.id, text);
  return { project, notes, images, image, doc };
}

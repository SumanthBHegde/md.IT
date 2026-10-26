import { beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../lib/sha256';
import {
  addImage,
  clearCloudLinks,
  clearDatabase,
  createDocument,
  createFolder,
  createProject,
  getDocument,
  getImageBytes,
  getProject,
  linkDocument,
  linkProject,
  listFolders,
  listImages,
  placeImages,
  recordVersionSaved,
  saveDocumentContent,
  setHeadVersion,
  writeVersionContent,
} from '.';

beforeEach(clearDatabase);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).buffer;
const OTHER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]).buffer;

async function linkedDoc() {
  const project = await createProject('Notes');
  const doc = await createDocument(project.id, null, 'Plan');
  await linkProject(project.id, 'cloud-p');
  await linkDocument(doc.id, { cloudDocumentId: 'cloud-d', headVersionId: 'v1' });
  return { project, doc };
}

describe('cloud links', () => {
  it('links and unlinks a project and a document', async () => {
    const { project, doc } = await linkedDoc();
    expect((await getProject(project.id))?.cloudProjectId).toBe('cloud-p');
    expect(await getDocument(doc.id)).toMatchObject({ cloudDocumentId: 'cloud-d', headVersionId: 'v1' });
    await linkProject(project.id, null);
    await linkDocument(doc.id, null);
    expect((await getProject(project.id))?.cloudProjectId).toBeUndefined();
    const unlinked = await getDocument(doc.id);
    expect(unlinked?.cloudDocumentId).toBeUndefined();
    expect(unlinked?.headVersionId).toBeUndefined();
  });

  it('clearCloudLinks(projectId) clears only that project and marks its documents dirty', async () => {
    const { project, doc } = await linkedDoc();
    await recordVersionSaved(doc.id, { cloudDocumentId: 'cloud-d', headVersionId: 'v1', content: '' });
    const other = await createProject('Other');
    await linkProject(other.id, 'cloud-o');
    await clearCloudLinks(project.id);
    expect((await getProject(project.id))?.cloudProjectId).toBeUndefined();
    const cleared = await getDocument(doc.id);
    expect(cleared?.dirty).toBe(true);
    expect(cleared?.cloudDocumentId).toBeUndefined();
    expect(cleared?.headVersionId).toBeUndefined();
    expect((await getProject(other.id))?.cloudProjectId).toBe('cloud-o');
  });

  it('clearCloudLinks() clears every project', async () => {
    const { project } = await linkedDoc();
    const other = await createProject('Other');
    await linkProject(other.id, 'cloud-o');
    await clearCloudLinks();
    expect((await getProject(project.id))?.cloudProjectId).toBeUndefined();
    expect((await getProject(other.id))?.cloudProjectId).toBeUndefined();
  });
});

describe('version bookkeeping', () => {
  it('recordVersionSaved clears dirty when the content is unchanged', async () => {
    const { doc } = await linkedDoc();
    await saveDocumentContent(doc.id, '# Saved');
    const result = await recordVersionSaved(doc.id, { cloudDocumentId: 'cloud-d', headVersionId: 'v2', content: '# Saved' });
    expect(result).toEqual({ dirty: false });
    expect(await getDocument(doc.id)).toMatchObject({ dirty: false, headVersionId: 'v2' });
  });

  it('recordVersionSaved keeps dirty when the content changed meanwhile', async () => {
    const { doc } = await linkedDoc();
    await saveDocumentContent(doc.id, '# Newer');
    const result = await recordVersionSaved(doc.id, { cloudDocumentId: 'cloud-d', headVersionId: 'v2', content: '# Saved' });
    expect(result).toEqual({ dirty: true });
    expect(await getDocument(doc.id)).toMatchObject({ dirty: true, headVersionId: 'v2', content: '# Newer' });
  });

  it('writeVersionContent replaces content, head and dirty', async () => {
    const { doc } = await linkedDoc();
    await writeVersionContent(doc.id, { content: '# Old', headVersionId: 'v3', dirty: true });
    expect(await getDocument(doc.id)).toMatchObject({ content: '# Old', headVersionId: 'v3', dirty: true });
  });

  it('setHeadVersion sets head and dirty', async () => {
    const { doc } = await linkedDoc();
    await setHeadVersion(doc.id, undefined, true);
    const updated = await getDocument(doc.id);
    expect(updated?.headVersionId).toBeUndefined();
    expect(updated?.dirty).toBe(true);
    await setHeadVersion(doc.id, 'v4', false);
    expect(await getDocument(doc.id)).toMatchObject({ headVersionId: 'v4', dirty: false });
  });
});

describe('placeImages', () => {
  const image = (path: string, bytes: ArrayBuffer = PNG) => ({ path, bytes, contentType: 'image/png' as const, sha256: sha256Hex(bytes) });

  it('adds missing images and their folders', async () => {
    const project = await createProject('Notes');
    expect(await placeImages(project.id, [image('notes/images/a.png')])).toEqual({ added: 1, kept: 0 });
    const folders = await listFolders(project.id);
    const notes = folders.find((f) => f.name === 'notes')!;
    const images = folders.find((f) => f.name === 'images')!;
    expect(notes.parentFolderId).toBeNull();
    expect(images.parentFolderId).toBe(notes.id);
    const [stored] = await listImages(project.id);
    expect(stored).toMatchObject({ name: 'a.png', folderId: images.id, contentType: 'image/png', sha256: sha256Hex(PNG) });
    expect(new Uint8Array((await getImageBytes(stored!.id))!)).toEqual(new Uint8Array(PNG));
  });

  it('keeps an image with the same hash', async () => {
    const project = await createProject('Notes');
    await placeImages(project.id, [image('a.png')]);
    expect(await placeImages(project.id, [image('a.png')])).toEqual({ added: 0, kept: 0 });
    expect(await listImages(project.id)).toHaveLength(1);
  });

  it('keeps a different item at the same path', async () => {
    const project = await createProject('Notes');
    await addImage(project.id, null, { name: 'a.png', type: 'image/png', bytes: OTHER });
    await createFolder(project.id, null, 'b.png');
    expect(await placeImages(project.id, [image('a.png'), image('b.png')])).toEqual({ added: 0, kept: 2 });
    const [kept] = await listImages(project.id);
    expect(kept!.sha256).toBe(sha256Hex(OTHER));
  });

  it('matches folder names case-insensitively', async () => {
    const project = await createProject('Notes');
    const folder = await createFolder(project.id, null, 'Notes');
    await placeImages(project.id, [image('notes/x.png')]);
    expect(await listFolders(project.id)).toHaveLength(1);
    expect((await listImages(project.id))[0]!.folderId).toBe(folder.id);
  });

  it('keeps the image when a document holds a folder name on its path', async () => {
    const project = await createProject('Notes');
    await createDocument(project.id, null, 'images');
    expect(await placeImages(project.id, [image('images.md/a.png')])).toEqual({ added: 0, kept: 1 });
  });
});

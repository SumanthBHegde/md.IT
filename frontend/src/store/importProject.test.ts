import { beforeEach, describe, expect, it } from 'vitest';
import { clearDatabase, importProject, listDocuments, listFolders, listImages, listProjectSummaries, NameConflictError, readProjectSnapshot } from '.';
import type { ProjectImportData } from './types';

beforeEach(clearDatabase);

const data = (extra: Partial<ProjectImportData> = {}): ProjectImportData => ({
  name: 'Imported',
  description: 'From a zip',
  folders: [['Guides'], ['Guides', 'images'], ['Empty']],
  documents: [
    { folder: [], title: 'Intro.md', content: '# Hi' },
    { folder: ['Guides'], title: 'Setup.md', content: 'Run.' },
  ],
  images: [{ folder: ['Guides', 'images'], name: 'a.png', contentType: 'image/png', bytes: new Uint8Array([1, 2, 3]).buffer }],
  ...extra,
});

describe('importProject', () => {
  it('creates a new project with every folder, document and image', async () => {
    const project = await importProject(data());
    expect(project).toMatchObject({ name: 'Imported', description: 'From a zip' });
    const folders = await listFolders(project.id);
    const guides = folders.find((f) => f.name === 'Guides')!;
    expect(folders.map((f) => f.name).sort()).toEqual(['Empty', 'Guides', 'images']);
    expect(folders.find((f) => f.name === 'images')!.parentFolderId).toBe(guides.id);
    expect((await listDocuments(project.id)).map((d) => [d.title, d.content, d.folderId]).sort()).toEqual([
      ['Intro.md', '# Hi', null],
      ['Setup.md', 'Run.', guides.id],
    ]);
    const [image] = await listImages(project.id);
    expect(image).toMatchObject({ name: 'a.png', contentType: 'image/png', size: 3 });
    expect(image!.sha256).toBe('039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
    const snapshot = await readProjectSnapshot(project.id);
    expect(Array.from(new Uint8Array(snapshot!.images[0]!.bytes))).toEqual([1, 2, 3]);
  });

  it('writes nothing when any part fails', async () => {
    const clash = data({ documents: [{ folder: [], title: 'A.md', content: '' }, { folder: [], title: 'a.md', content: '' }] });
    await expect(importProject(clash)).rejects.toBeInstanceOf(NameConflictError);
    expect(await listProjectSummaries()).toEqual([]);
  });

  it('refuses a document whose folder isn’t in the import', async () => {
    await expect(importProject(data({ documents: [{ folder: ['Nowhere'], title: 'A.md', content: '' }] }))).rejects.toThrow('“Nowhere” is missing');
    expect(await listProjectSummaries()).toEqual([]);
  });

  it('allows a name another project already has', async () => {
    await importProject(data());
    await importProject(data());
    expect((await listProjectSummaries()).map((p) => p.name)).toEqual(['Imported', 'Imported']);
  });

  it('stores cloud ids and dirty when given', async () => {
    const project = await importProject(
      data({
        cloudProjectId: 'cloud-p',
        documents: [{ folder: [], title: 'Intro.md', content: '# Hi', cloudDocumentId: 'cloud-d', headVersionId: 'v2', dirty: false }],
      }),
    );
    expect(project.cloudProjectId).toBe('cloud-p');
    const [doc] = await listDocuments(project.id);
    expect(doc).toMatchObject({ cloudDocumentId: 'cloud-d', headVersionId: 'v2', dirty: false });
  });

  it('documents without cloud fields stay dirty and unlinked', async () => {
    const project = await importProject(data());
    expect(project.cloudProjectId).toBeUndefined();
    expect((await listDocuments(project.id)).every((d) => d.dirty && d.cloudDocumentId === undefined)).toBe(true);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { clearDatabase, readProjectSnapshot } from '../store';
import { documentPath, folderNames, imagePath, referencedImages } from './paths';
import { makeProject } from './testProject';

beforeEach(clearDatabase);

describe('sync paths', () => {
  it('builds project-relative paths', async () => {
    const { project, doc, image, images } = await makeProject();
    const snapshot = (await readProjectSnapshot(project.id))!;
    const stored = snapshot.documents.find((d) => d.id === doc.id)!;
    expect(folderNames(snapshot.folders, images.id)).toEqual(['notes', 'images']);
    expect(folderNames(snapshot.folders, null)).toEqual([]);
    expect(documentPath(snapshot.folders, stored)).toBe('notes/Plan.md');
    expect(imagePath(snapshot.folders, snapshot.images.find((i) => i.id === image.id)!)).toBe('notes/images/a.png');
  });

  it('lists each referenced image once', async () => {
    const { project, doc } = await makeProject();
    const snapshot = (await readProjectSnapshot(project.id))!;
    const stored = snapshot.documents.find((d) => d.id === doc.id)!;
    const text = '![one](images/a.png)\n\n![two](../notes/images/a.png)\n\n![gone](images/b.png)';
    expect(referencedImages(snapshot, stored, text).map((i) => i.name)).toEqual(['a.png']);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../api';
import { sha256Hex } from '../lib/sha256';
import { addImage, clearDatabase, getDocument, getImageBytes, listDocuments, listImages, saveDocumentContent } from '../store';
import { createFakeApi, type FakeApi } from '../test/fakeApi';
import { deleteVersion, listVersions, readVersion } from './history';
import { loadVersion } from './loadVersion';
import { saveAsCopy } from './saveAsCopy';
import { saveVersion } from './saveVersion';
import { makeProject, PNG_HASH, TEXT } from './testProject';

let fake: FakeApi;
const api = () => createApi(fake.fetch);

beforeEach(async () => {
  await clearDatabase();
  fake = createFakeApi();
  fake.signIn();
});

/** v1 saved from this browser, v2 saved "elsewhere" with a new image. */
async function twoVersions() {
  const setup = await makeProject();
  const saved = await saveVersion(setup.doc.id, TEXT, null, api());
  if (saved.kind !== 'saved') throw new Error('first save failed');
  const cloudDocumentId = (await getDocument(setup.doc.id))!.cloudDocumentId!;
  const extra = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
  const extraHash = fake.putBlob(extra, 'image/png');
  const v2 = fake.addVersion(cloudDocumentId, '# Plan v2\n\n![b](images/b.png)\n', {
    images: [{ path: 'notes/images/b.png', hash: extraHash }],
  });
  return { ...setup, v1: saved.version, v2, extra, extraHash };
}

describe('loadVersion', () => {
  it('load latest writes the text, sets head, clears dirty and adds the images', async () => {
    const { doc, v2, project, extraHash } = await twoVersions();
    const result = await loadVersion(doc.id, v2.id, { asLatest: true }, api());
    expect(result).toEqual({ number: 2, keptImages: 0 });
    expect(await getDocument(doc.id)).toMatchObject({ content: '# Plan v2\n\n![b](images/b.png)\n', headVersionId: v2.id, dirty: false });
    const added = (await listImages(project.id)).find((i) => i.name === 'b.png')!;
    expect(added.sha256).toBe(extraHash);
    expect(sha256Hex((await getImageBytes(added.id))!)).toBe(extraHash);
  });

  it('restore of an older version keeps head at the latest and marks dirty', async () => {
    const { doc, v1, v2 } = await twoVersions();
    await loadVersion(doc.id, v2.id, { asLatest: true }, api());
    await loadVersion(doc.id, v1.id, { asLatest: false, latestId: v2.id }, api());
    expect(await getDocument(doc.id)).toMatchObject({ content: TEXT, headVersionId: v2.id, dirty: true });
    const next = await saveVersion(doc.id, TEXT, null, api());
    expect(next).toMatchObject({ kind: 'saved', version: { number: 3, parent_id: v2.id } });
  });

  it('keeps a different local image at a version’s path and says so', async () => {
    const { doc, v2, images, project } = await twoVersions();
    await addImage(project.id, images.id, { name: 'b.png', type: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]).buffer });
    const result = await loadVersion(doc.id, v2.id, { asLatest: true }, api());
    expect(result.keptImages).toBe(1);
    expect((await listImages(project.id)).filter((i) => i.name === 'b.png')).toHaveLength(1);
  });
});

describe('history', () => {
  it('listVersions is null for an unlinked document', async () => {
    const { doc } = await makeProject();
    expect(await listVersions(doc.id, api())).toBeNull();
  });

  it('lists versions newest first', async () => {
    const { doc } = await twoVersions();
    expect((await listVersions(doc.id, api()))!.map((v) => v.number)).toEqual([2, 1]);
  });

  it('listVersions returns null on 404 and keeps the link for the next save to judge', async () => {
    const { doc } = await twoVersions();
    const before = (await getDocument(doc.id))!;
    fake.documents.clear();
    expect(await listVersions(doc.id, api())).toBeNull();
    const stored = (await getDocument(doc.id))!;
    expect(stored.cloudDocumentId).toBe(before.cloudDocumentId);
    expect(stored.headVersionId).toBe(before.headVersionId);
  });

  it('readVersion returns the version and its text', async () => {
    const { v1 } = await twoVersions();
    const read = await readVersion(v1.id, api());
    expect(read.version.number).toBe(1);
    expect(read.text).toBe(TEXT);
    expect(read.version.images).toEqual([{ path: 'notes/images/a.png', hash: PNG_HASH }]);
  });

  it('deleting the head moves head to the new latest and marks dirty', async () => {
    const { doc, v1, v2 } = await twoVersions();
    await loadVersion(doc.id, v2.id, { asLatest: true }, api());
    await deleteVersion(doc.id, v2.id, api());
    expect(await getDocument(doc.id)).toMatchObject({ headVersionId: v1.id, dirty: true });
    expect(fake.versions.has(v2.id)).toBe(false);
  });

  it('deleting the head never adopts a newer version saved elsewhere (final review I5)', async () => {
    const { doc, v1, v2 } = await twoVersions(); // head v1 (saved here); v2 came from another browser
    expect((await getDocument(doc.id))!.headVersionId).toBe(v1.id);
    await deleteVersion(doc.id, v1.id, api());
    expect((await getDocument(doc.id))!.headVersionId).toBeUndefined();
    const next = await saveVersion(doc.id, TEXT, null, api());
    expect(next).toMatchObject({ kind: 'conflict', latest: { id: v2.id, number: 2 } });
  });

  it('deleting the head moves it to the next older version', async () => {
    const { doc, v1, v2 } = await twoVersions();
    await loadVersion(doc.id, v2.id, { asLatest: true }, api());
    const v3 = fake.addVersion((await getDocument(doc.id))!.cloudDocumentId!, '# v3 elsewhere');
    await deleteVersion(doc.id, v2.id, api());
    expect((await getDocument(doc.id))!.headVersionId).toBe(v1.id);
    expect(await saveVersion(doc.id, TEXT, null, api())).toMatchObject({ kind: 'conflict', latest: { id: v3.id } });
  });

  it('deleting the only version leaves no head', async () => {
    const { doc, v1 } = await makeProject().then(async (setup) => {
      const saved = await saveVersion(setup.doc.id, TEXT, null, api());
      return { ...setup, v1: saved.kind === 'saved' ? saved.version : null! };
    });
    await deleteVersion(doc.id, v1.id, api());
    expect((await getDocument(doc.id))!.headVersionId).toBeUndefined();
  });

  it('deleting another version leaves head alone', async () => {
    const { doc, v1, v2 } = await twoVersions();
    await loadVersion(doc.id, v2.id, { asLatest: true }, api());
    await deleteVersion(doc.id, v1.id, api());
    expect(await getDocument(doc.id)).toMatchObject({ headVersionId: v2.id, dirty: false });
  });
});

describe('saveAsCopy', () => {
  it('keeps my text in a new cloud document and loads the latest into the original', async () => {
    const { doc, v2, project } = await twoVersions();
    const mine = `${TEXT}\nMy change.`;
    await saveDocumentContent(doc.id, mine);
    const latest = { id: v2.id, number: 2, created_at: v2.created_at };
    const result = await saveAsCopy(doc.id, mine, 'Mine', latest, api());
    expect(result).toMatchObject({ copyTitle: 'Plan copy.md', originalTitle: 'Plan.md', number: 2 });
    const copy = (await getDocument(result.copyId))!;
    expect(copy.content).toBe(mine);
    expect(copy.cloudDocumentId).toBeDefined();
    expect(copy.cloudDocumentId).not.toBe((await getDocument(doc.id))!.cloudDocumentId);
    expect(fake.documents.get(copy.cloudDocumentId!)?.path).toBe('notes/Plan copy.md');
    expect([...fake.versions.values()].find((v) => v.document_id === copy.cloudDocumentId)).toMatchObject({ number: 1, parent_id: null, message: 'Mine' });
    expect(await getDocument(doc.id)).toMatchObject({ content: '# Plan v2\n\n![b](images/b.png)\n', headVersionId: v2.id, dirty: false });
    expect((await listDocuments(project.id)).map((d) => d.title).sort()).toEqual(['Plan copy.md', 'Plan.md']);
  });
});

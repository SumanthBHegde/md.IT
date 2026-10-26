import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../api';
import { sha256Hex } from '../lib/sha256';
import { clearDatabase, getImageBytes, getProject, listDocuments, listFolders, listImages } from '../store';
import { createFakeApi, type FakeApi, type FakeDocument } from '../test/fakeApi';
import { downloadProject, listCloudProjects } from './download';

let fake: FakeApi;
const api = () => createApi(fake.fetch);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 2]);

beforeEach(async () => {
  await clearDatabase();
  fake = createFakeApi();
  fake.signIn();
});

function cloudProject(name = 'Notes') {
  const project = { id: `p-${name}`, name, created_at: '2026-10-01T09:00:00.000Z' };
  fake.projects.set(project.id, project);
  return project;
}

function cloudDocument(projectId: string, path: string): FakeDocument {
  const doc = { id: `d-${path}`, project_id: projectId, path, created_at: '2026-10-01T09:00:00.000Z', next_number: 1 };
  fake.documents.set(doc.id, doc);
  return doc;
}

describe('download', () => {
  it('lists the account’s projects', async () => {
    cloudProject('Notes');
    expect((await listCloudProjects(api())).map((p) => p.name)).toEqual(['Notes']);
  });

  it('downloads latest versions into a new linked project with folders and images', async () => {
    const project = cloudProject();
    const plan = cloudDocument(project.id, 'notes/Plan.md');
    const imageHash = fake.putBlob(PNG, 'image/png');
    fake.addVersion(plan.id, '# Old');
    const latest = fake.addVersion(plan.id, '# Plan\n\n![a](images/a.png)\n', { images: [{ path: 'notes/images/a.png', hash: imageHash }] });
    const intro = cloudDocument(project.id, 'Intro.md');
    fake.addVersion(intro.id, '# Intro');

    const result = await downloadProject(project, api());
    expect(result).toMatchObject({ documents: 2, skipped: [] });
    const local = (await getProject(result.projectId))!;
    expect(local).toMatchObject({ name: 'Notes', cloudProjectId: project.id });
    const folders = await listFolders(local.id);
    expect(folders.map((f) => f.name).sort()).toEqual(['images', 'notes']);
    const docs = await listDocuments(local.id);
    const planDoc = docs.find((d) => d.title === 'Plan.md')!;
    expect(planDoc).toMatchObject({ content: '# Plan\n\n![a](images/a.png)\n', cloudDocumentId: plan.id, headVersionId: latest.id, dirty: false });
    expect(planDoc.folderId).toBe(folders.find((f) => f.name === 'notes')!.id);
    const [image] = await listImages(local.id);
    expect(image).toMatchObject({ name: 'a.png', folderId: folders.find((f) => f.name === 'images')!.id });
    expect(sha256Hex((await getImageBytes(image!.id))!)).toBe(imageHash);
  });

  it('skips documents without versions', async () => {
    const project = cloudProject();
    cloudDocument(project.id, 'Empty.md');
    const kept = cloudDocument(project.id, 'Kept.md');
    fake.addVersion(kept.id, '# Kept');
    const result = await downloadProject(project, api());
    expect(result).toMatchObject({ documents: 1, skipped: [] });
    expect((await listDocuments(result.projectId)).map((d) => d.title)).toEqual(['Kept.md']);
  });

  it('reports clashing paths instead of overwriting', async () => {
    const project = cloudProject();
    const first = cloudDocument(project.id, 'a.md');
    fake.addVersion(first.id, '# first');
    const second = cloudDocument(project.id, 'A.md');
    fake.addVersion(second.id, '# second');
    const result = await downloadProject(project, api());
    // The most recently saved one wins (final review I2).
    expect(result.documents).toBe(1);
    expect(result.skipped).toEqual(['a.md (a document with this name is already there)']);
    expect((await listDocuments(result.projectId)).map((d) => d.content)).toEqual(['# second']);
  });

  it('reports an image whose path another file holds', async () => {
    const project = cloudProject();
    const one = cloudDocument(project.id, 'one.md');
    const two = cloudDocument(project.id, 'two.md');
    const pngA = fake.putBlob(PNG, 'image/png');
    const pngB = fake.putBlob(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9]), 'image/png');
    fake.addVersion(one.id, '![](x.png)', { images: [{ path: 'x.png', hash: pngA }] });
    fake.addVersion(two.id, '![](x.png)', { images: [{ path: 'x.png', hash: pngB }] });
    const result = await downloadProject(project, api());
    expect(result.skipped).toEqual(['x.png (another file has this name)']);
    expect(await listImages(result.projectId)).toHaveLength(1);
  });

  it('shares one image used by two documents', async () => {
    const project = cloudProject();
    const hash = fake.putBlob(PNG, 'image/png');
    for (const path of ['one.md', 'two.md']) {
      fake.addVersion(cloudDocument(project.id, path).id, '![](x.png)', { images: [{ path: 'x.png', hash }] });
    }
    const result = await downloadProject(project, api());
    expect(result.skipped).toEqual([]);
    expect(await listImages(result.projectId)).toHaveLength(1);
  });

  it('merges a folder saved under two spellings (final review I1)', async () => {
    const project = cloudProject();
    fake.addVersion(cloudDocument(project.id, 'notes/a.md').id, '# a');
    fake.addVersion(cloudDocument(project.id, 'Notes/b.md').id, '# b');
    const hash = fake.putBlob(PNG, 'image/png');
    fake.addVersion(cloudDocument(project.id, 'NOTES/c.md').id, '![](images/x.png)', { images: [{ path: 'NOTES/images/x.png', hash }] });
    const result = await downloadProject(project, api());
    expect(result).toMatchObject({ documents: 3, skipped: [] });
    const folders = await listFolders(result.projectId);
    // One folder, spelled as in the most recently saved document.
    expect(folders.filter((f) => f.parentFolderId === null).map((f) => f.name)).toEqual(['NOTES']);
    expect(await listImages(result.projectId)).toHaveLength(1);
  });

  it('keeps the most recently saved document when two share a path (final review I2)', async () => {
    const project = cloudProject();
    const old = { id: 'd-old', project_id: project.id, path: 'Plan.md', created_at: '2026-10-01T09:00:00.000Z', next_number: 1 };
    fake.documents.set(old.id, old);
    fake.addVersion(old.id, '# old plan');
    const current = { id: 'd-new', project_id: project.id, path: 'Plan.md', created_at: '2026-10-02T09:00:00.000Z', next_number: 1 };
    fake.documents.set(current.id, current);
    fake.addVersion(current.id, '# current plan');
    const result = await downloadProject(project, api());
    expect(result.skipped).toEqual(['Plan.md (a document with this name is already there)']);
    const [doc] = await listDocuments(result.projectId);
    expect(doc).toMatchObject({ content: '# current plan', cloudDocumentId: 'd-new' });
  });
});


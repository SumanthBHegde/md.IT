import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError, createApi } from '../api';
import { sha256Hex } from '../lib/sha256';
import { clearDatabase, getDocument, getProject, renameDocument, saveDocumentContent } from '../store';
import { createFakeApi, type FakeApi } from '../test/fakeApi';
import { saveVersion } from './saveVersion';
import { makeProject, PNG_HASH, TEXT } from './testProject';

let fake: FakeApi;

beforeEach(async () => {
  await clearDatabase();
  fake = createFakeApi();
  fake.signIn();
});

const api = () => createApi(fake.fetch);
const posted = (path: RegExp) => fake.calls.filter((c) => c.method === 'POST' && path.test(c.path));

describe('saveVersion', () => {
  it('first save creates the cloud project and document and saves v1', async () => {
    const { project, doc } = await makeProject();
    const result = await saveVersion(doc.id, TEXT, 'First', api());
    expect(result).toMatchObject({ kind: 'saved', dirty: false, version: { number: 1, parent_id: null, message: 'First' } });
    const cloudProjectId = (await getProject(project.id))!.cloudProjectId!;
    expect(fake.projects.get(cloudProjectId)?.name).toBe('Notes');
    const stored = (await getDocument(doc.id))!;
    expect(fake.documents.get(stored.cloudDocumentId!)?.path).toBe('notes/Plan.md');
    expect(stored).toMatchObject({ headVersionId: result.kind === 'saved' ? result.version.id : '', dirty: false });
  });

  it('second save uses the head as parent', async () => {
    const { doc } = await makeProject();
    const first = await saveVersion(doc.id, TEXT, null, api());
    await saveDocumentContent(doc.id, `${TEXT}\nMore.`);
    const second = await saveVersion(doc.id, `${TEXT}\nMore.`, null, api());
    expect(second).toMatchObject({ kind: 'saved', version: { number: 2 } });
    expect(second.kind === 'saved' && first.kind === 'saved' && second.version.parent_id === first.version.id).toBe(true);
    expect(posted(/^\/api\/projects$/)).toHaveLength(1);
  });

  it('uploads the content and referenced images once, skipping known blobs', async () => {
    const { doc } = await makeProject();
    await saveVersion(doc.id, TEXT, null, api());
    expect(fake.blobs.get(sha256Hex(TEXT))?.content_type).toBe('text/markdown');
    expect(fake.blobs.get(PNG_HASH)?.content_type).toBe('image/png');
    const putsBefore = fake.calls.filter((c) => c.method === 'PUT').length;
    await saveVersion(doc.id, TEXT, 'again', api());
    expect(fake.calls.filter((c) => c.method === 'PUT')).toHaveLength(putsBefore);
  });

  it('test_image_referenced_twice_is_sent_once', async () => {
    // Review Focus 3: two hrefs, one image.
    const text = '![one](images/a.png)\n\n![two](../notes/images/a.png)\n';
    const { doc } = await makeProject(text);
    await saveVersion(doc.id, text, null, api());
    const body = posted(/\/versions$/)[0]!.body as { images: unknown[] };
    expect(body.images).toEqual([{ path: 'notes/images/a.png', hash: PNG_HASH }]);
  });

  it('test_save_after_rename_sends_new_path', async () => {
    // Review Focus 2: the cloud document follows a local rename.
    const { doc } = await makeProject();
    await saveVersion(doc.id, TEXT, null, api());
    await renameDocument(doc.id, 'Renamed');
    await saveVersion(doc.id, TEXT, null, api());
    expect((posted(/\/versions$/)[1]!.body as { path: string }).path).toBe('notes/Renamed.md');
    expect(fake.documents.get((await getDocument(doc.id))!.cloudDocumentId!)?.path).toBe('notes/Renamed.md');
  });

  it('returns the conflict with the latest on 409', async () => {
    const { doc } = await makeProject();
    const first = await saveVersion(doc.id, TEXT, null, api());
    const cloudDocumentId = (await getDocument(doc.id))!.cloudDocumentId!;
    fake.addVersion(cloudDocumentId, '# From the other browser');
    const result = await saveVersion(doc.id, TEXT, null, api());
    expect(result).toMatchObject({ kind: 'conflict', latest: { number: 2 } });
    expect((await getDocument(doc.id))!.headVersionId).toBe(first.kind === 'saved' ? first.version.id : '');
  });

  it('relinks once when the cloud project is gone', async () => {
    const { project, doc } = await makeProject();
    await saveVersion(doc.id, TEXT, null, api());
    const oldProject = (await getProject(project.id))!.cloudProjectId;
    fake.projects.clear();
    fake.documents.clear();
    const result = await saveVersion(doc.id, TEXT, null, api());
    expect(result).toMatchObject({ kind: 'saved', version: { number: 1, parent_id: null } });
    const relinked = (await getProject(project.id))!.cloudProjectId;
    expect(relinked).toBeDefined();
    expect(relinked).not.toBe(oldProject);
  });

  it('a second 404 is an error', async () => {
    const { doc } = await makeProject();
    await saveVersion(doc.id, TEXT, null, api());
    // Every version POST answers 404: the relinked attempt fails the same way.
    const goneApi = createApi(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.method === 'POST' && request.url.endsWith('/versions')) {
        return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return fake.fetch(request);
    });
    await expect(saveVersion(doc.id, TEXT, null, goneApi)).rejects.toMatchObject({ status: 404 });
    expect(posted(/^\/api\/projects$/)).toHaveLength(2); // the first save, then one relink
  });

  it('keeps dirty when the text changed during the save', async () => {
    const { doc } = await makeProject();
    let edited = false;
    const editingApi = createApi(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.method === 'HEAD' && !edited) {
        edited = true;
        await saveDocumentContent(doc.id, `${TEXT}\nTyped meanwhile.`);
      }
      return fake.fetch(request);
    });
    const result = await saveVersion(doc.id, TEXT, null, editingApi);
    expect(result).toMatchObject({ kind: 'saved', dirty: true });
    expect((await getDocument(doc.id))!.dirty).toBe(true);
  });

  it('sends the message, or null for blank', async () => {
    const { doc } = await makeProject();
    await saveVersion(doc.id, TEXT, '   ', api());
    expect((posted(/\/versions$/)[0]!.body as { message: unknown }).message).toBeNull();
  });

  it('rejects with ApiError offline when the server is down', async () => {
    const { doc } = await makeProject();
    fake.offline = true;
    const failure = saveVersion(doc.id, TEXT, null, api());
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ code: 'offline' });
  });
});

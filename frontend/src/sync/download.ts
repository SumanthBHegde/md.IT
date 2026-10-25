import { getApi, request, type Api, type ProjectOut } from '../api';
import { importProject, nameKey, type ProjectImportData } from '../store';
import { fetchVersion } from './loadVersion';
import { pool, TRANSFERS } from './pool';

export async function listCloudProjects(api: Api = getApi()): Promise<ProjectOut[]> {
  return request(() => api.GET('/api/projects'));
}

/** Path → key that matches the store's sibling-name rule (P-008: case-insensitive). */
const key = (path: string) => path.split('/').map(nameKey).join('/');

/** New device (spec 5b 6.6, P-082): import a cloud project's latest versions as a new local
 * project, in one transaction. Never overwrites: clashing paths are skipped and reported. */
export async function downloadProject(
  cloud: Pick<ProjectOut, 'id' | 'name'>,
  api: Api = getApi(),
): Promise<{ projectId: string; documents: number; skipped: string[] }> {
  const documents = await request(() => api.GET('/api/projects/{project_id}/documents', { params: { path: { project_id: cloud.id } } }));
  const saved = documents.filter((doc) => doc.latest !== null);
  const fetched = new Map<string, Awaited<ReturnType<typeof fetchVersion>>>();
  await pool(saved, TRANSFERS, async (doc) => {
    fetched.set(doc.id, await fetchVersion(doc.latest!.id, api));
  });

  const data: ProjectImportData = { name: cloud.name, description: '', cloudProjectId: cloud.id, folders: [], documents: [], images: [] };
  const skipped: string[] = [];
  /** Every claimed path (files and their folders), by key: 'file' or 'folder'; image hashes by key. */
  const claimed = new Map<string, 'file' | 'folder'>();
  const imageHashes = new Map<string, string>();

  const folderChainFree = (segments: string[]) =>
    segments.every((_, i) => claimed.get(key(segments.slice(0, i + 1).join('/'))) !== 'file');
  const claimFolders = (segments: string[]) => {
    for (let i = 0; i < segments.length; i++) {
      const path = segments.slice(0, i + 1);
      if (!claimed.has(key(path.join('/')))) {
        claimed.set(key(path.join('/')), 'folder');
        data.folders.push(path);
      }
    }
  };

  // Documents first, in the server's path order: the first one claiming a path wins.
  for (const doc of saved) {
    const segments = doc.path.split('/');
    const title = segments.pop()!;
    if (claimed.has(key(doc.path)) || !folderChainFree(segments)) {
      skipped.push(`${doc.path} (a document with this name is already there)`);
      continue;
    }
    claimFolders(segments);
    claimed.set(key(doc.path), 'file');
    const version = fetched.get(doc.id)!;
    data.documents.push({
      folder: segments, title, content: version.text, cloudDocumentId: doc.id, headVersionId: version.version.id, dirty: false,
    });
  }
  for (const doc of saved) {
    for (const image of fetched.get(doc.id)!.images) {
      const k = key(image.path);
      if (imageHashes.get(k) === image.sha256) continue; // the same image, used by several documents
      const segments = image.path.split('/');
      const name = segments.pop()!;
      if (claimed.has(k) || !folderChainFree(segments)) {
        skipped.push(`${image.path} (another file has this name)`);
        continue;
      }
      claimFolders(segments);
      claimed.set(k, 'file');
      imageHashes.set(k, image.sha256);
      data.images.push({ folder: segments, name, contentType: image.contentType, bytes: image.bytes });
    }
  }
  // Parents before children, as importProject needs.
  data.folders.sort((a, b) => a.length - b.length);
  const project = await importProject(data);
  return { projectId: project.id, documents: data.documents.length, skipped };
}

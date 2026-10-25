import { getApi, type Api, type LatestOut } from '../api';
import { duplicateDocument, getDocument, NotFoundError, saveDocumentContent } from '../store';
import { loadVersion } from './loadVersion';
import { saveVersion } from './saveVersion';

/** "Save mine as a copy" (spec 5b 6.3, P-080): my text becomes a new document, saved as the
 * first version of its own cloud document; the original then loads the latest version. */
export async function saveAsCopy(
  docId: string,
  text: string,
  message: string | null,
  latest: LatestOut,
  api: Api = getApi(),
): Promise<{ copyId: string; copyTitle: string; originalTitle: string; number: number }> {
  const copy = await duplicateDocument(docId);
  await saveDocumentContent(copy.id, text);
  const saved = await saveVersion(copy.id, text, message, api);
  if (saved.kind !== 'saved') throw new Error('A new document can’t conflict with another version.');
  await loadVersion(docId, latest.id, { asLatest: true }, api);
  const original = await getDocument(docId);
  if (!original) throw new NotFoundError('This document no longer exists.');
  return { copyId: copy.id, copyTitle: copy.title, originalTitle: original.title, number: latest.number };
}

import { useCallback, useEffect, useState } from 'react';
import { ApiError, type LatestOut } from '../api';
import { useAuth } from '../auth';
import { setHeadVersion, StoreError } from '../store';
import { deleteVersion, loadVersion, saveAsCopy, saveVersion } from '../sync';
import type { DocumentDraft } from './useDocumentDraft';

export const SESSION_ENDED = 'Your session ended. Sign in again to save versions.';

export interface Conflict {
  latest: LatestOut;
  /** What the user tried to save, kept for "Save mine as a copy". */
  text: string;
  message: string | null;
}

export interface VersionActions {
  conflict: Conflict | null;
  /** Number of the version this document was last saved or loaded as in this session. */
  lastNumber: number | null;
  /** Bumped after every save, load, restore or delete, so the history list reloads. */
  refreshKey: number;
  save(message: string | null): Promise<void>;
  loadLatest(): Promise<void>;
  saveCopy(): Promise<void>;
  dismissConflict(): void;
  restore(versionId: string, number: number, latestId: string): Promise<boolean>;
  remove(versionId: string): Promise<boolean>;
}

export interface VersionActionsInput {
  docId: string | undefined;
  draft: DocumentDraft;
  /** The editor's text right now (the last keystroke, not the last autosave). */
  currentText: () => string;
  notify: (text: string) => void;
  openDocument: (docId: string) => void;
}

const kept = (count: number) => (count > 0 ? ` ${count} ${count === 1 ? 'image' : 'images'} already in this project were kept.` : '');
const sentence = (text: string) => text.replace(/[.\s]+$/, '');

/** Workspace glue for versions (spec 5b 6.2–6.5): flush, call sync, reload the editor, say what happened. */
export function useVersionActions({ docId, draft, currentText, notify, openDocument }: VersionActionsInput): VersionActions {
  const auth = useAuth();
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [lastNumber, setLastNumber] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const changed = useCallback(() => setRefreshKey((n) => n + 1), []);

  useEffect(() => {
    setLastNumber(null);
    setConflict(null);
  }, [docId]);

  const report = useCallback(
    (error: unknown, what: string) => {
      if (error instanceof ApiError && error.status === 401) {
        auth.sessionEnded();
        notify(SESSION_ENDED);
        return;
      }
      if (!(error instanceof ApiError) && !(error instanceof StoreError)) console.error(error);
      const reason = error instanceof Error ? sentence(error.message) : 'something went wrong';
      notify(`Couldn’t ${what}: ${reason}. Your work is still saved in this browser.`);
    },
    [auth, notify],
  );

  const save = useCallback(
    async (message: string | null) => {
      if (!docId) return;
      try {
        await draft.flush();
        const text = currentText();
        let result = await saveVersion(docId, text, message);
        if (result.kind === 'conflict' && result.latest === null) {
          // Every version was deleted elsewhere: nothing to load, so this becomes the first one.
          await setHeadVersion(docId, undefined, true);
          result = await saveVersion(docId, text, message);
        }
        if (result.kind === 'conflict') {
          if (result.latest) setConflict({ latest: result.latest, text, message });
          return;
        }
        setLastNumber(result.version.number);
        changed();
      } catch (error) {
        report(error, 'save a version');
      }
    },
    [docId, draft, currentText, changed, report],
  );

  const loadLatest = useCallback(async () => {
    if (!docId || !conflict) return;
    try {
      const { number, keptImages } = await loadVersion(docId, conflict.latest.id, { asLatest: true });
      setConflict(null);
      draft.reload();
      setLastNumber(number);
      changed();
      notify(`Loaded version ${number}.${kept(keptImages)}`);
    } catch (error) {
      report(error, 'load the latest version');
    }
  }, [docId, conflict, draft, changed, notify, report]);

  const saveCopy = useCallback(async () => {
    if (!docId || !conflict) return;
    try {
      const { copyId, copyTitle, originalTitle } = await saveAsCopy(docId, conflict.text, conflict.message, conflict.latest);
      setConflict(null);
      changed();
      openDocument(copyId);
      notify(`Saved your changes as “${copyTitle}”. “${originalTitle}” now has the latest version.`);
    } catch (error) {
      report(error, 'save your copy');
    }
  }, [docId, conflict, changed, openDocument, notify, report]);

  const restore = useCallback(
    async (versionId: string, number: number, latestId: string) => {
      if (!docId) return false;
      try {
        await draft.flush();
        const mode = versionId === latestId ? ({ asLatest: true } as const) : ({ asLatest: false, latestId } as const);
        const { keptImages } = await loadVersion(docId, versionId, mode);
        draft.reload();
        setLastNumber(mode.asLatest ? number : null);
        changed();
        notify(`Restored version ${number}.${kept(keptImages)}`);
        return true;
      } catch (error) {
        report(error, 'restore the version');
        return false;
      }
    },
    [docId, draft, changed, notify, report],
  );

  const remove = useCallback(
    async (versionId: string) => {
      if (!docId) return false;
      try {
        await deleteVersion(docId, versionId);
        changed();
        return true;
      } catch (error) {
        report(error, 'delete the version');
        return false;
      }
    },
    [docId, changed, report],
  );

  const dismissConflict = useCallback(() => setConflict(null), []);
  return { conflict, lastNumber, refreshKey, save, loadLatest, saveCopy, dismissConflict, restore, remove };
}

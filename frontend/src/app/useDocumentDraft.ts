import { useCallback, useEffect, useMemo, useState } from 'react';
import { debounce } from '../lib/debounce';
import { getDocument, NotFoundError, saveDocumentContent } from '../store';

export type SaveState = 'saved' | 'saving' | 'failed';
export type DraftStatus = 'none' | 'loading' | 'missing' | 'ready';

export interface DocumentDraft {
  status: DraftStatus;
  initialContent: string;
  previewSource: string;
  saveState: SaveState;
  onChange: (content: string) => void;
  saveNow: () => void;
  /** Write any pending or failed edit now; resolves once it is stored (rejects if it can't be). */
  flush: () => Promise<void>;
  /** Read the document again (after a restore or load wrote new content into the store). */
  reload: () => void;
  /** Bumped by reload; the editor is keyed on it so it remounts with the new content. */
  revision: number;
}

export interface DraftOptions {
  saveDelay?: number;
  previewDelay?: number;
}

type Loaded = { id: string; found: false } | { id: string; found: true; content: string };

export function useDocumentDraft(docId: string | undefined, { saveDelay = 1000, previewDelay = 150 }: DraftOptions = {}): DocumentDraft {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [previewSource, setPreviewSource] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    getDocument(docId).then(
      (doc) => {
        if (cancelled) return;
        setLoaded(doc ? { id: docId, found: true, content: doc.content } : { id: docId, found: false });
        setPreviewSource(doc?.content ?? '');
        setSaveState('saved');
      },
      () => {
        if (!cancelled) setLoaded({ id: docId, found: false });
      },
    );
    return () => {
      cancelled = true;
      // Forget this load: reopening the document later must read it again, never reuse stale content.
      setLoaded(null);
    };
  }, [docId, revision]);

  // One saver per document, so a pending save always lands in the document it was typed into.
  const saver = useMemo(() => {
    if (!docId) return null;
    let latest = 0;
    /** Latest content not yet confirmed written; kept after a failure so it can be retried. */
    let unsaved: string | null = null;
    /** The last write started, settled either way; flushAsync waits on it. */
    let inflight: Promise<void> = Promise.resolve();
    const write = (content: string) => {
      const ticket = ++latest;
      inflight = saveDocumentContent(docId, content).then(
        () => {
          if (unsaved === content) unsaved = null;
          if (ticket === latest && !debounced.pending()) setSaveState('saved');
        },
        (error: unknown) => {
          if (error instanceof NotFoundError) {
            unsaved = null; // deleted meanwhile; nothing left to save
            return;
          }
          console.error(error);
          if (ticket === latest) setSaveState('failed');
        },
      );
    };
    const flush = () => {
      if (debounced.pending()) debounced.flush();
      else if (unsaved !== null) {
        setSaveState('saving');
        write(unsaved);
      }
    };
    const debounced = debounce(write, saveDelay);
    return {
      schedule(content: string) {
        unsaved = content;
        debounced(content);
      },
      /** Write now: the pending edit, or retry the last one that failed. */
      flush,
      async flushAsync() {
        flush();
        await inflight;
        // Still pending means an edit typed during the wait, which autosave has in hand: not a failure.
        if (unsaved !== null && !debounced.pending()) throw new Error('Your last changes couldn’t be saved in this browser.');
      },
      hasUnsaved: () => unsaved !== null,
    };
  }, [docId, saveDelay]);

  // Flush on document switch, unmount, tab hide and page unload.
  useEffect(() => {
    if (!saver) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      saver.flush();
      // The write above is asynchronous; ask before leaving while anything is not confirmed saved.
      if (saver.hasUnsaved()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') saver.flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      saver.flush();
    };
  }, [saver]);

  const previewer = useMemo(() => debounce((content: string) => setPreviewSource(content), previewDelay), [previewDelay]);
  // A preview scheduled for the previous document must not overwrite the next one.
  useEffect(() => () => previewer.cancel(), [previewer, docId]);

  const onChange = useCallback(
    (content: string) => {
      if (!saver) return;
      setSaveState('saving');
      saver.schedule(content);
      previewer(content);
    },
    [saver, previewer],
  );

  const saveNow = useCallback(() => saver?.flush(), [saver]);
  const flush = useCallback(async () => {
    await saver?.flushAsync();
  }, [saver]);
  const reload = useCallback(() => {
    // Forget the old text in the same render as the new revision: otherwise the editor remounts
    // under the new key with the old text, and the fresh read lands without another remount.
    setLoaded(null);
    setRevision((n) => n + 1);
  }, []);

  const current = docId && loaded?.id === docId ? loaded : null;
  const status: DraftStatus = !docId ? 'none' : !current ? 'loading' : current.found ? 'ready' : 'missing';
  return {
    status,
    initialContent: current?.found ? current.content : '',
    previewSource,
    saveState,
    onChange,
    saveNow,
    flush,
    reload,
    revision,
  };
}

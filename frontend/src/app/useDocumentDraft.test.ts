import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocument, NotFoundError, saveDocumentContent, type MdDocument } from '../store';
import { useDocumentDraft } from './useDocumentDraft';

vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>();
  return { ...actual, getDocument: vi.fn(), saveDocumentContent: vi.fn() };
});

const getDocumentMock = vi.mocked(getDocument);
const saveMock = vi.mocked(saveDocumentContent);

function fakeDoc(id: string): MdDocument {
  return { id, projectId: 'p', folderId: null, title: `${id}.md`, content: `content of ${id}`, dirty: true, createdAt: 0, updatedAt: 0 };
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  getDocumentMock.mockImplementation(async (id) => (id === 'gone' ? null : fakeDoc(id)));
  saveMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useDocumentDraft', () => {
  it('is "none" without a document', () => {
    const { result } = renderHook(() => useDocumentDraft(undefined));
    expect(result.current.status).toBe('none');
  });

  it('loads the document content', async () => {
    const { result } = renderHook(() => useDocumentDraft('a'));
    expect(result.current.status).toBe('loading');
    await advance(0);
    expect(result.current).toMatchObject({ status: 'ready', initialContent: 'content of a', previewSource: 'content of a', saveState: 'saved' });
  });

  it('reports a missing document', async () => {
    const { result } = renderHook(() => useDocumentDraft('gone'));
    await advance(0);
    expect(result.current.status).toBe('missing');
  });

  it('saves once, 1 s after the last edit, and shows saving until then', async () => {
    const { result } = renderHook(() => useDocumentDraft('a'));
    await advance(0);
    act(() => result.current.onChange('one'));
    act(() => result.current.onChange('two'));
    expect(result.current.saveState).toBe('saving');
    await advance(999);
    expect(saveMock).not.toHaveBeenCalled();
    await advance(1);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith('a', 'two');
    expect(result.current.saveState).toBe('saved');
  });

  it('updates the preview 150 ms after an edit', async () => {
    const { result } = renderHook(() => useDocumentDraft('a'));
    await advance(0);
    act(() => result.current.onChange('# New'));
    await advance(149);
    expect(result.current.previewSource).toBe('content of a');
    await advance(1);
    expect(result.current.previewSource).toBe('# New');
  });

  it('saveNow writes immediately', async () => {
    const { result } = renderHook(() => useDocumentDraft('a'));
    await advance(0);
    act(() => result.current.onChange('now'));
    await act(async () => result.current.saveNow());
    expect(saveMock).toHaveBeenCalledWith('a', 'now');
  });

  it('saves pending edits to the previous document when switching', async () => {
    const { result, rerender } = renderHook(({ id }) => useDocumentDraft(id), { initialProps: { id: 'a' } });
    await advance(0);
    act(() => result.current.onChange('typed into a'));
    rerender({ id: 'b' });
    await advance(0);
    expect(saveMock).toHaveBeenCalledWith('a', 'typed into a');
    expect(saveMock).not.toHaveBeenCalledWith('b', expect.anything());
    expect(result.current).toMatchObject({ status: 'ready', initialContent: 'content of b', previewSource: 'content of b' });
    await advance(2000);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it('saves pending edits on unmount', async () => {
    const { result, unmount } = renderHook(() => useDocumentDraft('a'));
    await advance(0);
    act(() => result.current.onChange('bye'));
    unmount();
    expect(saveMock).toHaveBeenCalledWith('a', 'bye');
  });

  it('saves pending edits when the tab is hidden', async () => {
    const { result } = renderHook(() => useDocumentDraft('a'));
    await advance(0);
    act(() => result.current.onChange('hidden'));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(saveMock).toHaveBeenCalledWith('a', 'hidden');
  });

  it('shows a failure, then recovers on the next edit', async () => {
    saveMock.mockRejectedValueOnce(new Error('quota'));
    const { result } = renderHook(() => useDocumentDraft('a'));
    await advance(0);
    act(() => result.current.onChange('x'));
    await advance(1000);
    expect(result.current.saveState).toBe('failed');
    act(() => result.current.onChange('xy'));
    await advance(1000);
    expect(result.current.saveState).toBe('saved');
  });

  it('ignores a save for a document deleted meanwhile', async () => {
    saveMock.mockRejectedValueOnce(new NotFoundError('This document no longer exists.'));
    const { result } = renderHook(() => useDocumentDraft('a'));
    await advance(0);
    act(() => result.current.onChange('late'));
    await advance(1000);
    expect(result.current.saveState).not.toBe('failed');
  });

  it('keeps showing saving while a newer edit is still pending', async () => {
    let resolveFirst!: () => void;
    saveMock.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }));
    const { result } = renderHook(() => useDocumentDraft('a'));
    await advance(0);
    act(() => result.current.onChange('first'));
    await advance(1000);
    act(() => result.current.onChange('second'));
    await act(async () => resolveFirst());
    expect(result.current.saveState).toBe('saving');
    await advance(1000);
    expect(result.current.saveState).toBe('saved');
  });

  it('reloads fresh content when the same document is reopened after closing it', async () => {
    const { result, rerender } = renderHook(({ id }: { id: string | undefined }) => useDocumentDraft(id), { initialProps: { id: 'a' as string | undefined } });
    await advance(0);
    expect(result.current.initialContent).toBe('content of a');
    getDocumentMock.mockImplementation(async (id) => ({ ...fakeDoc(id!), content: 'saved later' }));
    rerender({ id: undefined });
    rerender({ id: 'a' });
    expect(result.current.status).toBe('loading');
    await advance(0);
    expect(result.current).toMatchObject({ status: 'ready', initialContent: 'saved later' });
  });

  it('retries a failed save on saveNow', async () => {
    saveMock.mockRejectedValueOnce(new Error('quota'));
    const { result } = renderHook(() => useDocumentDraft('a'));
    await advance(0);
    act(() => result.current.onChange('keep me'));
    await advance(1000);
    expect(result.current.saveState).toBe('failed');
    await act(async () => result.current.saveNow());
    expect(saveMock).toHaveBeenLastCalledWith('a', 'keep me');
    expect(result.current.saveState).toBe('saved');
  });

  it('asks before the page closes while changes are unsaved', async () => {
    saveMock.mockRejectedValueOnce(new Error('quota')).mockRejectedValueOnce(new Error('quota'));
    const { result } = renderHook(() => useDocumentDraft('a'));
    await advance(0);
    act(() => result.current.onChange('unsaved'));
    await advance(1000);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not ask before the page closes once everything is saved', async () => {
    const { result } = renderHook(() => useDocumentDraft('a'));
    await advance(0);
    act(() => result.current.onChange('saved'));
    await advance(1000);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('flush resolves after the pending edit is written', async () => {
    let finish!: () => void;
    saveMock.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useDocumentDraft('a'));
    await advance(0);
    act(() => result.current.onChange('typed'));
    let done = false;
    const flushing = result.current.flush().then(() => (done = true));
    await advance(0);
    expect(saveMock).toHaveBeenCalledWith('a', 'typed');
    expect(done).toBe(false);
    finish();
    await act(() => flushing);
    expect(done).toBe(true);
  });

  it('flush resolves at once when nothing is pending', async () => {
    const { result } = renderHook(() => useDocumentDraft('a'));
    await advance(0);
    await act(() => result.current.flush());
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('flush rejects when the write fails', async () => {
    saveMock.mockRejectedValue(new Error('disk full'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useDocumentDraft('a'));
    await advance(0);
    act(() => result.current.onChange('typed'));
    await expect(act(() => result.current.flush())).rejects.toThrow();
  });

  it('reload re-reads content and bumps revision', async () => {
    const { result } = renderHook(() => useDocumentDraft('a'));
    await advance(0);
    expect(result.current.revision).toBe(0);
    getDocumentMock.mockImplementation(async (id) => ({ ...fakeDoc(id), content: 'restored' }));
    act(() => result.current.reload());
    // Loading at once: the editor must not remount under the new revision with the old text.
    expect(result.current.status).toBe('loading');
    await advance(0);
    expect(result.current.status).toBe('ready');
    expect(result.current.initialContent).toBe('restored');
    expect(result.current.previewSource).toBe('restored');
    expect(result.current.revision).toBe(1);
  });
});

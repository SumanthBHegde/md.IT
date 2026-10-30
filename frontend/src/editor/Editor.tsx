import { openSearchPanel } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorToolbar } from './EditorToolbar';
import { createExtensions } from './extensions';
import { blockInsert, COMMANDS, editorStatus, statusKey, type CommandId, type EditorStatus } from './formatting';

const INITIAL_STATUS: EditorStatus = { active: [], heading: 0, canUndo: false, canRedo: false };

export interface EditorProps {
  initialContent: string;
  onChange: (content: string) => void;
  onSave: () => void;
  /** Image files dropped (at = document position) or pasted (at = null). */
  onImageFiles?: (files: File[], at: number | null) => void;
  /** The toolbar's Insert image button. */
  onInsertImage?: () => void;
}

export interface EditorHandle {
  /** Insert `text` as its own block at `at`, or at the cursor (the end if the editor never had focus). One undo step. */
  insertBlock(text: string, at?: number | null): void;
  /** Put the cursor at the start of 0-based `line` (clamped) and scroll it to the top. */
  revealLine(line: number): void;
  /** Select [from, to) (clamped) and scroll it into view. */
  select(from: number, to: number): void;
  /** The current text, including edits not yet saved. */
  getText(): string;
}

/** Uncontrolled CodeMirror editor. Give it a `key` per document to load different content. */
export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor({ initialContent, onChange, onSave, onImageFiles, onInsertImage }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const focusedRef = useRef(false);
  const callbacks = useRef({ onChange, onSave, onImageFiles });
  useEffect(() => {
    callbacks.current = { onChange, onSave, onImageFiles };
  });

  // Kept here, and set only when it changes, so that typing never re-renders the workspace.
  const [status, setStatus] = useState(INITIAL_STATUS);
  const shownStatus = useRef(statusKey(INITIAL_STATUS));
  const updateStatus = useCallback((state: EditorState) => {
    const next = editorStatus(state);
    const key = statusKey(next);
    if (key === shownStatus.current) return;
    shownStatus.current = key;
    setStatus(next);
  }, []);

  const runCommand = useCallback((id: CommandId) => {
    const view = viewRef.current;
    if (!view) return;
    COMMANDS[id](view);
    view.focus();
    focusedRef.current = true;
  }, []);

  const openFind = useCallback(() => {
    if (viewRef.current) openSearchPanel(viewRef.current);
  }, []);

  useImperativeHandle(ref, () => ({
    insertBlock(text, at = null) {
      const view = viewRef.current;
      if (!view) return;
      const doc = view.state.doc;
      // `at` can be stale: the text may have changed while an image was being stored.
      const from = Math.min(at ?? (focusedRef.current ? view.state.selection.main.head : doc.length), doc.length);
      view.dispatch(blockInsert(view.state, text, from), { userEvent: 'input.paste' });
      focusedRef.current = true; // later inserts follow this one
    },
    revealLine(line) {
      const view = viewRef.current;
      if (!view) return;
      const { doc } = view.state;
      const pos = doc.line(Math.min(Math.max(line + 1, 1), doc.lines)).from;
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start' }) });
      view.focus();
      focusedRef.current = true;
    },
    select(from, to) {
      const view = viewRef.current;
      if (!view) return;
      const clamp = (n: number) => Math.min(Math.max(n, 0), view.state.doc.length);
      const anchor = clamp(from);
      view.dispatch({ selection: { anchor, head: clamp(to) }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) });
      view.focus();
      focusedRef.current = true;
    },
    getText() {
      return viewRef.current?.state.doc.toString() ?? '';
    },
  }), []);

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: initialContent,
        extensions: createExtensions({
          onChange: (content) => callbacks.current.onChange(content),
          onSave: () => callbacks.current.onSave(),
          onImageFiles: (files, at) => callbacks.current.onImageFiles?.(files, at),
          onFocus: () => {
            focusedRef.current = true;
          },
          onUpdate: updateStatus,
        }),
      }),
    });
    viewRef.current = view;
    updateStatus(view.state);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uncontrolled: content is read once per mount
  }, []);

  return (
    <>
      <EditorToolbar status={status} onCommand={runCommand} onFind={openFind} onInsertImage={onInsertImage} />
      <div className="editor-host" ref={hostRef} />
    </>
  );
});

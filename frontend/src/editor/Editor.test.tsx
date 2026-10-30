import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { Editor, type EditorHandle } from './Editor';

function setup(initialContent = '# Hello') {
  const onChange = vi.fn();
  const onSave = vi.fn();
  const { container, unmount } = render(<Editor initialContent={initialContent} onChange={onChange} onSave={onSave} />);
  const editorEl = container.querySelector<HTMLElement>('.cm-editor')!;
  const view = EditorView.findFromDOM(editorEl)!;
  return { container, view, onChange, onSave, unmount };
}

describe('Editor', () => {
  it('shows the initial content', () => {
    const { container } = setup();
    expect(container.querySelector('.cm-content')?.textContent).toContain('# Hello');
  });

  it('reports the full document on every edit', () => {
    const { view, onChange } = setup();
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '\nWorld' } }));
    expect(onChange).toHaveBeenLastCalledWith('# Hello\nWorld');
  });

  it('does not report a change when nothing changed', () => {
    const { view, onChange } = setup();
    act(() => view.dispatch({ selection: { anchor: 0 } }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('saves on Ctrl+S', () => {
    const { container, onSave } = setup();
    fireEvent.keyDown(container.querySelector('.cm-content')!, { key: 's', ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('supports undo', () => {
    const { container, view, onChange } = setup('a');
    act(() => view.dispatch({ changes: { from: 1, insert: 'b' }, userEvent: 'input' }));
    fireEvent.keyDown(container.querySelector('.cm-content')!, { key: 'z', ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith('a');
  });

  it('cleans up on unmount', () => {
    const { container, unmount } = setup();
    unmount();
    expect(container.querySelector('.cm-editor')).toBeNull();
  });
});

describe('Editor toolbar', () => {
  const button = (name: RegExp) => screen.getByRole('button', { name });

  it('formats the selection from a button and keeps the editor usable', async () => {
    const { view, onChange } = setup('word');
    act(() => view.dispatch({ selection: { anchor: 0, head: 4 } }));
    await userEvent.click(button(/^Bold/));
    expect(onChange).toHaveBeenLastCalledWith('**word**');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('word');
    expect(view.hasFocus).toBe(true);
  });

  it('marks what the cursor is in as it moves', async () => {
    const { view } = setup('**bold** plain');
    act(() => view.dispatch({ selection: { anchor: 3 } }));
    await waitFor(() => expect(button(/^Bold/)).toHaveAttribute('aria-pressed', 'true'));
    act(() => view.dispatch({ selection: { anchor: 11 } }));
    await waitFor(() => expect(button(/^Bold/)).not.toHaveAttribute('aria-pressed', 'true'));
  });

  it('undoes through the toolbar', async () => {
    const { view, onChange } = setup('word');
    expect(button(/^Undo/)).toBeDisabled();
    act(() => view.dispatch({ selection: { anchor: 0, head: 4 } }));
    await userEvent.click(button(/^Italic/));
    await userEvent.click(button(/^Undo/));
    expect(onChange).toHaveBeenLastCalledWith('word');
    expect(button(/^Redo/)).toBeEnabled();
  });

  it('runs formatting shortcuts, including over a default binding', () => {
    const { container, view, onChange } = setup('word');
    act(() => view.dispatch({ selection: { anchor: 0, head: 4 } }));
    const content = container.querySelector('.cm-content')!;
    fireEvent.keyDown(content, { key: 'b', ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith('**word**');
    fireEvent.keyDown(content, { key: 'i', ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith('***word***');
  });

  it('sets a heading from the style menu and shows it', async () => {
    const { onChange } = setup('Title');
    await userEvent.click(screen.getByRole('button', { name: 'Text style: Normal text' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Heading 2/ }));
    expect(onChange).toHaveBeenLastCalledWith('## Title');
    expect(await screen.findByRole('button', { name: 'Text style: Heading 2' })).toBeInTheDocument();
  });

  it('opens find and replace from the button, with its labels in sentence case', async () => {
    const { container } = setup();
    await userEvent.click(button(/^Find and replace/));
    expect(container.querySelector('.cm-search')).not.toBeNull();
    expect(within(container.querySelector<HTMLElement>('.cm-search')!).getByRole('button', { name: 'Replace all' })).toBeInTheDocument();
  });

  it('opens find and replace with Ctrl+H', () => {
    const { container } = setup();
    fireEvent.keyDown(container.querySelector('.cm-content')!, { key: 'h', ctrlKey: true });
    expect(container.querySelector('.cm-search')).not.toBeNull();
  });
});

describe('Editor insert and images', () => {
  const setupWithHandle = (content = 'hello') => {
    const ref = createRef<EditorHandle>();
    const onChange = vi.fn();
    const onImageFiles = vi.fn();
    const { container } = render(<Editor ref={ref} initialContent={content} onChange={onChange} onSave={() => {}} onImageFiles={onImageFiles} />);
    return { ref, onChange, onImageFiles, content: container.querySelector<HTMLElement>('.cm-content')! };
  };

  it('clamps a stale drop position to the document', () => {
    const { ref, onChange } = setupWithHandle('# Hello');
    act(() => ref.current!.insertBlock('![a](a.png)', 999));
    expect(onChange).toHaveBeenLastCalledWith('# Hello\n\n![a](a.png)');
  });

  it('inserts a block at the end before the editor has had focus, then at the cursor', () => {
    const { ref, onChange } = setupWithHandle('# Hello');
    act(() => ref.current!.insertBlock('![a](a.png)'));
    expect(onChange).toHaveBeenLastCalledWith('# Hello\n\n![a](a.png)');
    act(() => ref.current!.insertBlock('![b](b.png)'));
    // the cursor sits after the first insert, which is the end
    expect(onChange).toHaveBeenLastCalledWith('# Hello\n\n![a](a.png)\n\n![b](b.png)');
  });

  it('inserts at an explicit position, separated by blank lines', () => {
    const { ref, onChange } = setupWithHandle('hello\nworld');
    act(() => ref.current!.insertBlock('X', 0));
    expect(onChange).toHaveBeenLastCalledWith('X\n\nhello\nworld');
  });

  it('adds only the newlines that are missing', () => {
    const { ref, onChange } = setupWithHandle('a\n\nb');
    act(() => ref.current!.insertBlock('X', 3)); // start of "b", right after a blank line
    expect(onChange).toHaveBeenLastCalledWith('a\n\nX\n\nb');
  });

  it('uses the cursor once the editor has had focus', () => {
    const { ref, onChange, content } = setupWithHandle('hello');
    fireEvent.focus(content);
    act(() => ref.current!.insertBlock('X'));
    // CodeMirror starts with the cursor at 0
    expect(onChange).toHaveBeenLastCalledWith('X\n\nhello');
  });

  it('hands dropped and pasted images to onImageFiles', () => {
    const { onImageFiles, content } = setupWithHandle();
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.drop(content, { dataTransfer: { files: [png], types: ['Files'] } });
    expect(onImageFiles).toHaveBeenCalledTimes(1);
    expect(onImageFiles.mock.calls[0]![0]).toEqual([png]);
    fireEvent.paste(content, { clipboardData: { files: [png], types: ['Files'] } });
    expect(onImageFiles).toHaveBeenCalledTimes(2);
    expect(onImageFiles.mock.calls[1]).toEqual([[png], null]);
  });

  it('ignores files that aren’t images', () => {
    const { onImageFiles, content } = setupWithHandle();
    fireEvent.paste(content, { clipboardData: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })], types: ['Files'], getData: () => '' } });
    expect(onImageFiles).not.toHaveBeenCalled();
  });
});

function setupWithHandle(initialContent: string) {
  const ref = createRef<EditorHandle>();
  const { container } = render(<Editor ref={ref} initialContent={initialContent} onChange={vi.fn()} onSave={vi.fn()} />);
  const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;
  return { handle: () => ref.current!, view };
}

describe('Editor handle navigation', () => {
  it('reveals a line with the cursor at its start', () => {
    const { handle, view } = setupWithHandle('a\nbb\nccc');
    act(() => handle().revealLine(2));
    expect(view.state.selection.main.head).toBe(5);
  });

  it('clamps a line past either end', () => {
    const { handle, view } = setupWithHandle('a\nbb\nccc');
    act(() => handle().revealLine(99));
    expect(view.state.selection.main.head).toBe(5);
    act(() => handle().revealLine(-3));
    expect(view.state.selection.main.head).toBe(0);
  });

  it('selects a range, clamped to the document', () => {
    const { handle, view } = setupWithHandle('hello world');
    act(() => handle().select(6, 11));
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('world');
    act(() => handle().select(6, 500));
    expect(view.state.selection.main.to).toBe(11);
  });

  it('returns the text typed so far', () => {
    const { handle, view } = setupWithHandle('a');
    act(() => view.dispatch({ changes: { from: 1, insert: 'bc' } }));
    expect(handle().getText()).toBe('abc');
  });
});

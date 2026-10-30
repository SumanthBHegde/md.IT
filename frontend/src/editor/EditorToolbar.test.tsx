import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditorToolbar } from './EditorToolbar';
import type { EditorStatus } from './formatting';

const plain: EditorStatus = { active: [], heading: 0, canUndo: true, canRedo: false };

function mount(status: Partial<EditorStatus> = {}, extra: { onInsertImage?: () => void } = {}) {
  const onCommand = vi.fn();
  const onFind = vi.fn();
  render(<EditorToolbar status={{ ...plain, ...status }} onCommand={onCommand} onFind={onFind} {...extra} />);
  return { onCommand, onFind, row: screen.getByRole('toolbar', { name: 'Formatting' }) };
}

describe('EditorToolbar', () => {
  it('names each button with its shortcut and runs its command', async () => {
    const { onCommand } = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Bold (Ctrl+B)' }));
    expect(onCommand).toHaveBeenLastCalledWith('bold');
    await userEvent.click(screen.getByRole('button', { name: 'Numbered list (Ctrl+Shift+7)' }));
    expect(onCommand).toHaveBeenLastCalledWith('ordered');
    await userEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(onCommand).toHaveBeenLastCalledWith('table');
  });

  it('marks what the cursor is in, and only that', () => {
    mount({ active: ['bold', 'bullet'] });
    expect(screen.getByRole('button', { name: 'Bold (Ctrl+B)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Bulleted list (Ctrl+Shift+8)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Italic (Ctrl+I)' })).not.toHaveAttribute('aria-pressed', 'true');
  });

  it('disables undo and redo when there is nothing to do', () => {
    mount({ canUndo: false, canRedo: false });
    expect(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo (Ctrl+Y)' })).toBeDisabled();
  });

  it('shows the line’s style and sets another from the menu', async () => {
    const { onCommand } = mount({ heading: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'Text style: Heading 2' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Heading 3/ }));
    expect(onCommand).toHaveBeenLastCalledWith('heading3');
  });

  it('offers the wide-only tools in More', async () => {
    const { onCommand } = mount();
    await userEvent.click(screen.getByRole('button', { name: 'More formatting' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Diagram' }));
    expect(onCommand).toHaveBeenLastCalledWith('diagram');
  });

  it('opens find, and shows Insert image only when it can', async () => {
    const onInsertImage = vi.fn();
    const { onFind } = mount({}, { onInsertImage });
    await userEvent.click(screen.getByRole('button', { name: 'Find and replace (Ctrl+F)' }));
    expect(onFind).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Insert image' }));
    expect(onInsertImage).toHaveBeenCalled();
  });

  it('hides Insert image with nothing to call', () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Insert image' })).not.toBeInTheDocument();
  });

  it('keeps the editor’s focus when a button is pressed', () => {
    const { row } = mount();
    expect(fireEvent.mouseDown(row)).toBe(false); // default prevented
  });

  it('is one Tab stop, and the arrow keys move along the row', () => {
    const { row } = mount({ canUndo: false });
    const stops = () => [...row.querySelectorAll('button')].filter((button) => button.tabIndex === 0);
    expect(stops()).toHaveLength(1);
    stops()[0]!.focus();
    const start = document.activeElement;
    fireEvent.keyDown(row, { key: 'ArrowRight' });
    expect(document.activeElement).not.toBe(start);
    expect(stops()).toEqual([document.activeElement]);
    fireEvent.keyDown(row, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(start);
    fireEvent.keyDown(row, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Find and replace (Ctrl+F)' }));
    fireEvent.keyDown(row, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(start); // wraps past a disabled Undo
  });
});

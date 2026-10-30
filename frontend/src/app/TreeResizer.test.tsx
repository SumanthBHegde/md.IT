import { fireEvent, render, renderHook, screen, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDatabase, getSetting, setSetting, SETTINGS } from '../store';
import { clampTreeWidth, TreeResizer, useTreeWidth } from './TreeResizer';

beforeEach(clearDatabase);

function mount(width = 264) {
  const onResize = vi.fn();
  const onResizeEnd = vi.fn();
  render(<TreeResizer width={width} onResize={onResize} onResizeEnd={onResizeEnd} />);
  return { handle: screen.getByRole('separator', { name: 'Resize file tree' }), onResize, onResizeEnd };
}

describe('clampTreeWidth', () => {
  it('keeps widths inside 200–400 and falls back on junk', () => {
    expect(clampTreeWidth(120)).toBe(200);
    expect(clampTreeWidth(900)).toBe(400);
    expect(clampTreeWidth(300.4)).toBe(300);
    expect(clampTreeWidth('wide')).toBe(264);
    expect(clampTreeWidth(Number.NaN)).toBe(264);
  });
});

describe('TreeResizer', () => {
  it('announces its range and value', () => {
    const { handle } = mount(300);
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('aria-valuemin', '200');
    expect(handle).toHaveAttribute('aria-valuemax', '400');
    expect(handle).toHaveAttribute('aria-valuenow', '300');
  });

  it('follows the pointer and saves only on release', () => {
    const { handle, onResize, onResizeEnd } = mount(264);
    fireEvent.pointerDown(handle, { clientX: 264, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 320, pointerId: 1 });
    expect(onResize).toHaveBeenLastCalledWith(320);
    expect(onResizeEnd).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { clientX: 320, pointerId: 1 });
    expect(onResizeEnd).toHaveBeenCalledExactlyOnceWith(320);
  });

  it('clamps a drag past the limits', () => {
    const { handle, onResize } = mount(264);
    fireEvent.pointerDown(handle, { clientX: 264, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });
    expect(onResize).toHaveBeenLastCalledWith(400);
  });

  it('ignores movement when no drag started', () => {
    const { handle, onResize } = mount();
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it('resizes from the keyboard and saves at once', () => {
    const { handle, onResizeEnd } = mount(264);
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onResizeEnd).toHaveBeenLastCalledWith(280);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onResizeEnd).toHaveBeenLastCalledWith(248);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(onResizeEnd).toHaveBeenLastCalledWith(200);
    fireEvent.keyDown(handle, { key: 'End' });
    expect(onResizeEnd).toHaveBeenLastCalledWith(400);
  });
});

describe('useTreeWidth', () => {
  it('starts from the stored width', async () => {
    await setSetting(SETTINGS.treeWidth, 320);
    const { result } = renderHook(() => useTreeWidth());
    await waitFor(() => expect(result.current.width).toBe(320));
  });

  it('shows a preview at once and stores only the final width', async () => {
    const { result } = renderHook(() => useTreeWidth());
    act(() => result.current.preview(300));
    expect(result.current.width).toBe(300);
    expect(await getSetting(SETTINGS.treeWidth, null)).toBeNull();
    act(() => result.current.commit(310));
    expect(result.current.width).toBe(310);
    await waitFor(async () => expect(await getSetting(SETTINGS.treeWidth, null)).toBe(310));
  });
});

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { SETTINGS, useSettingState } from '../store';

const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 264;
const KEY_STEP = 16;

export function clampTreeWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_WIDTH;
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)));
}

/** The file tree's width: a drag shows at once, and only the final width is stored. */
export function useTreeWidth() {
  const [stored, setStored] = useSettingState<number>(SETTINGS.treeWidth, DEFAULT_WIDTH);
  const [live, setLive] = useState<number | null>(null);
  const commit = useCallback(
    (width: number) => {
      setLive(width);
      setStored(width);
    },
    [setStored],
  );
  return { width: live ?? clampTreeWidth(stored), preview: setLive, commit };
}

export interface TreeResizerProps {
  width: number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
}

/** The handle between the file tree and the document (the sidebar-width token's 200–400px). */
export function TreeResizer({ width, onResize, onResizeEnd }: TreeResizerProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const at = (event: PointerEvent) => clampTreeWidth(drag.current!.startWidth + event.clientX - drag.current!.startX);

  const onKeyDown = (event: KeyboardEvent) => {
    const next = { ArrowLeft: width - KEY_STEP, ArrowRight: width + KEY_STEP, Home: MIN_WIDTH, End: MAX_WIDTH }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onResizeEnd(clampTreeWidth(next));
  };

  return (
    <div
      className="ws-resizer"
      role="separator"
      tabIndex={0}
      aria-label="Resize file tree"
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      onPointerDown={(event) => {
        drag.current = { startX: event.clientX, startWidth: width };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current) onResize(at(event));
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        onResizeEnd(at(event));
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={onKeyDown}
    />
  );
}

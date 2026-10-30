import { useCallback, useEffect, useRef, useState, type MouseEvent, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { IconButton } from './IconButton';
import type { IconName } from './icons';
import { Menu, type MenuItem } from './Menu';

const MENU_WIDTH = 208;

export interface MenuButtonProps {
  items: readonly MenuItem[];
  label: string;
  icon?: IconName;
  size?: 'sm' | 'md';
  /** App extension (P-013): a text button (e.g. "Sign in") instead of an icon button; `icon` then leads the text. */
  text?: string;
  /** App extension (P-097): an icon after the text, such as the chevron of a dropdown. */
  iconRight?: IconName;
}

/** An IconButton (or a text Button) that opens a Menu in a fixed-position popover (never clipped by scrolling panels). */
export function MenuButton({ items, label, icon = 'more', size, text, iconRight }: MenuButtonProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  /** The trigger: the IconButton itself, or the span around a text Button (Button doesn't forward refs). */
  const buttonRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setPosition(null), []);

  useEffect(() => {
    if (!position) return;
    popoverRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const onPointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
      (buttonRef.current?.querySelector('button') ?? buttonRef.current)?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [position, close]);

  const toggle = (event: MouseEvent) => {
    event.stopPropagation();
    if (position) return close();
    const rect = buttonRef.current!.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, left: Math.max(8, rect.right - MENU_WIDTH) });
  };

  const wrapped = items.map((item): MenuItem =>
    item === 'separator'
      ? item
      : {
          ...item,
          onSelect: () => {
            close();
            item.onSelect?.();
          },
        },
  );

  return (
    <>
      {text === undefined ? (
        <IconButton
          ref={buttonRef as Ref<HTMLButtonElement>}
          icon={icon}
          label={label}
          size={size}
          aria-haspopup="menu"
          aria-expanded={position !== null}
          onClick={toggle}
        />
      ) : (
        <span ref={buttonRef as Ref<HTMLSpanElement>} className="md-menu-anchor">
          <Button
            icon={icon === 'more' ? undefined : icon}
            iconRight={iconRight}
            size={size}
            aria-label={label}
            title={label === text ? undefined : label}
            aria-haspopup="menu"
            aria-expanded={position !== null}
            onClick={toggle}
          >
            {text}
          </Button>
        </span>
      )}
      {position &&
        createPortal(
          // React events bubble through portals; stop them so a row behind the menu never activates.
          <div
            ref={popoverRef}
            className="md-menu-popover"
            style={{ top: position.top, left: position.left }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Menu items={wrapped} />
          </div>,
          document.body,
        )}
    </>
  );
}

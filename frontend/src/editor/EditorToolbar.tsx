import { useEffect, useRef, type KeyboardEvent } from 'react';
import { IconButton, MenuButton, type IconName, type MenuItem } from '../ui';
import type { CommandId, EditorStatus, InlineStyle, InsertKind, LineStyle } from './formatting';
import { EDITOR_KEYS, FIND_KEY, keyParts, withKey, withShortcut } from './shortcuts';
import './editor.css';

export interface EditorToolbarProps {
  status: EditorStatus;
  onCommand: (id: CommandId) => void;
  onFind: () => void;
  /** Hidden when there is nowhere to pick an image from. */
  onInsertImage?: () => void;
}

interface Tool {
  id: CommandId;
  label: string;
  icon: IconName;
}

const HEADINGS = [0, 1, 2, 3, 4, 5, 6] as const;
const headingLabel = (level: number) => (level === 0 ? 'Normal text' : `Heading ${level}`);

const INLINE_TOOLS: ReadonlyArray<Tool & { id: InlineStyle }> = [
  { id: 'bold', label: 'Bold', icon: 'bold' },
  { id: 'italic', label: 'Italic', icon: 'italic' },
  { id: 'strikethrough', label: 'Strikethrough', icon: 'strikethrough' },
  { id: 'highlight', label: 'Highlight', icon: 'highlight' },
  { id: 'code', label: 'Inline code', icon: 'code' },
];

const LIST_TOOLS: ReadonlyArray<Tool & { id: LineStyle }> = [
  { id: 'bullet', label: 'Bulleted list', icon: 'list-bullet' },
  { id: 'ordered', label: 'Numbered list', icon: 'list-numbered' },
  { id: 'task', label: 'Checklist', icon: 'list-check' },
];

const BLOCK_TOOLS: ReadonlyArray<Tool & { id: LineStyle | InsertKind }> = [
  { id: 'quote', label: 'Quote', icon: 'quote' },
  { id: 'codeBlock', label: 'Code block', icon: 'code-block' },
  { id: 'divider', label: 'Divider', icon: 'minus' },
];

const INSERT_TOOLS: ReadonlyArray<Tool & { id: InsertKind }> = [
  { id: 'table', label: 'Table', icon: 'table' },
  { id: 'math', label: 'Math', icon: 'sigma' },
  { id: 'diagram', label: 'Diagram', icon: 'diagram' },
];

/** The buttons a person can reach: ones in a group the width has hidden don't count. */
function reachable(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll('button')].filter(
    (button) => !button.disabled && getComputedStyle(button.closest('.editor-toolbar-group') ?? button).display !== 'none',
  );
}

/** One Tab stop for the whole row (the toolbar pattern): `stop`, or the last one, or the first. */
function setTabStop(root: HTMLElement, stop?: HTMLElement) {
  const buttons = reachable(root);
  const current = stop ?? buttons.find((button) => button.dataset.tabStop !== undefined) ?? buttons[0];
  root.querySelectorAll('button').forEach((button) => {
    button.tabIndex = button === current ? 0 : -1;
    if (button === current) button.dataset.tabStop = '';
    else delete button.dataset.tabStop;
  });
}

/** The Word-style row of the editor's main actions. Every button says what it does in a tooltip. */
export function EditorToolbar({ status, onCommand, onFind, onInsertImage }: EditorToolbarProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (rowRef.current) setTabStop(rowRef.current);
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = reachable(event.currentTarget);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    const last = buttons.length - 1;
    const next = { ArrowLeft: index === 0 ? last : index - 1, ArrowRight: index === last ? 0 : index + 1, Home: 0, End: last }[event.key];
    buttons[next!]!.focus();
  };

  const tool = ({ id, label, icon }: Tool) => (
    <IconButton
      key={id}
      icon={icon}
      label={withShortcut(label, id)}
      active={(status.active as string[]).includes(id) || undefined}
      onClick={() => onCommand(id)}
    />
  );

  const menuItem = ({ id, label, icon }: Tool): MenuItem => ({ label, icon, onSelect: () => onCommand(id) });
  const styleItems: MenuItem[] = HEADINGS.map((level) => {
    const id = `heading${level}` as const;
    return {
      label: headingLabel(level),
      icon: status.heading === level ? 'check' : undefined,
      shortcut: keyParts(EDITOR_KEYS[id]!).join('+'),
      onSelect: () => onCommand(id),
    };
  });

  return (
    <div className="editor-toolbar-frame">
      <div
        ref={rowRef}
        className="editor-toolbar"
        role="toolbar"
        aria-label="Formatting"
        // Clicking a button must not take the focus, and so the selection's highlight, from the editor.
        onMouseDown={(event) => event.preventDefault()}
        onFocus={(event) => setTabStop(event.currentTarget, event.target)}
        onKeyDown={onKeyDown}
      >
        <div className="editor-toolbar-group">
          <IconButton icon="undo" label={withShortcut('Undo', 'undo')} disabled={!status.canUndo} onClick={() => onCommand('undo')} />
          <IconButton icon="redo" label={withShortcut('Redo', 'redo')} disabled={!status.canRedo} onClick={() => onCommand('redo')} />
        </div>
        <div className="editor-toolbar-group editor-toolbar-style">
          <MenuButton
            size="sm"
            text={headingLabel(status.heading)}
            label={`Text style: ${headingLabel(status.heading)}`}
            iconRight="chevron-down"
            items={styleItems}
          />
        </div>
        <div className="editor-toolbar-group">{INLINE_TOOLS.map(tool)}</div>
        <div className="editor-toolbar-group">{LIST_TOOLS.map(tool)}</div>
        <div className="editor-toolbar-group editor-toolbar-wide">{BLOCK_TOOLS.map(tool)}</div>
        <div className="editor-toolbar-group">
          {tool({ id: 'link', label: 'Link', icon: 'link' })}
          {onInsertImage && <IconButton icon="image" label="Insert image" onClick={onInsertImage} />}
        </div>
        <div className="editor-toolbar-group editor-toolbar-wide">{INSERT_TOOLS.map(tool)}</div>
        <div className="editor-toolbar-group editor-toolbar-more">
          <MenuButton label="More formatting" items={[...BLOCK_TOOLS.map(menuItem), 'separator', ...INSERT_TOOLS.map(menuItem)]} />
        </div>
        <div className="editor-toolbar-group editor-toolbar-find">
          <IconButton icon="search" label={withKey('Find and replace', FIND_KEY)} onClick={onFind} />
        </div>
      </div>
    </div>
  );
}

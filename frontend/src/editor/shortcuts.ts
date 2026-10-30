import type { CommandId } from './formatting';

/** Keys in CodeMirror's notation; one list for the keymap, the tooltips and the help dialog. */
export const EDITOR_KEYS: Partial<Record<CommandId, string>> = {
  undo: 'Mod-z',
  redo: 'Mod-y',
  bold: 'Mod-b',
  italic: 'Mod-i',
  strikethrough: 'Mod-Shift-x',
  highlight: 'Mod-Shift-h',
  code: 'Mod-e',
  link: 'Mod-k',
  ordered: 'Mod-Shift-7',
  bullet: 'Mod-Shift-8',
  task: 'Mod-Shift-9',
  heading0: 'Mod-Alt-0',
  heading1: 'Mod-Alt-1',
  heading2: 'Mod-Alt-2',
  heading3: 'Mod-Alt-3',
  heading4: 'Mod-Alt-4',
  heading5: 'Mod-Alt-5',
  heading6: 'Mod-Alt-6',
};

export const FIND_KEY = 'Mod-f';
export const REPLACE_KEY = 'Mod-h';

const isMac = () => /mac|iphone|ipad/i.test(navigator.platform);

/** `Mod-Shift-x` as the keys to press here: `['Ctrl', 'Shift', 'X']`, or `['⌘', 'Shift', 'X']` on a Mac. */
export function keyParts(key: string): string[] {
  return key.split('-').map((part) => {
    if (part === 'Mod') return isMac() ? '⌘' : 'Ctrl';
    if (part === 'Alt' && isMac()) return '⌥';
    return part.length === 1 ? part.toUpperCase() : part;
  });
}

/** The label with its shortcut, for a tooltip: `Bold (Ctrl+B)`. */
export function withKey(label: string, key: string | undefined): string {
  return key ? `${label} (${keyParts(key).join('+')})` : label;
}

export const withShortcut = (label: string, command: CommandId) => withKey(label, EDITOR_KEYS[command]);

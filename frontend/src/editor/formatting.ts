import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState, type StateCommand, type Transaction, type TransactionSpec } from '@codemirror/state';

export type InlineStyle = 'bold' | 'italic' | 'strikethrough' | 'highlight' | 'code';
export type LineStyle = 'bullet' | 'ordered' | 'task' | 'quote';
export type InsertKind = 'codeBlock' | 'divider' | 'link' | 'table' | 'math' | 'diagram';
export type CommandId = 'undo' | 'redo' | InlineStyle | LineStyle | InsertKind | `heading${0 | 1 | 2 | 3 | 4 | 5 | 6}`;

/** What the toolbar shows for the cursor. `active` is sorted, so two statuses compare by key. */
export interface EditorStatus {
  active: Array<InlineStyle | LineStyle | 'link' | 'codeBlock'>;
  /** 0 is normal text. */
  heading: number;
  canUndo: boolean;
  canRedo: boolean;
}

const INLINE: Record<InlineStyle, { marker: string; node?: string }> = {
  bold: { marker: '**', node: 'StrongEmphasis' },
  italic: { marker: '*', node: 'Emphasis' },
  strikethrough: { marker: '~~', node: 'Strikethrough' },
  code: { marker: '`', node: 'InlineCode' },
  highlight: { marker: '==' }, // the Markdown parser doesn't know this one: see highlightAround
};

const INLINE_STYLES = Object.keys(INLINE) as InlineStyle[];
const USER_EVENT = 'input.format';

/** The text of a list item's marker, with its indent. Task must be tried before bullet. */
const LINE_PATTERNS: Record<Exclude<LineStyle, 'quote'>, RegExp> = {
  task: /^(\s*)[-*+]\s+\[[ xX]\]\s+/,
  bullet: /^(\s*)[-*+]\s+/,
  ordered: /^(\s*)\d+[.)]\s+/,
};
const LIST_STYLES = ['task', 'bullet', 'ordered'] as const;
const QUOTE = /^ {0,3}>\s?/;
const HEADING = /^ {0,3}(#{1,6})\s+/;

interface Pair {
  from: number;
  to: number;
  /** Length of the marker at each end. */
  size: number;
}

/** A ==highlight== around the range, found from the line's text. */
function highlightAround(state: EditorState, from: number, to: number): Pair | null {
  const line = state.doc.lineAt(from);
  if (to > line.to) return null;
  for (const match of line.text.matchAll(/==(?![\s=])(.+?)(?<!\s)==/g)) {
    const start = line.from + match.index;
    const end = start + match[0].length;
    if (start <= from && to <= end) return { from: start, to: end, size: 2 };
  }
  return null;
}

/** The nearest `name` syntax node holding the whole range. */
function nodeAround(state: EditorState, name: string, from: number, to: number) {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(from, from === to ? 0 : 1); node; node = node.parent) {
    if (node.name === name && node.from <= from && to <= node.to) return node;
  }
  return null;
}

function pairAround(state: EditorState, style: InlineStyle, from: number, to: number): Pair | null {
  const { marker, node: name } = INLINE[style];
  if (!name) return highlightAround(state, from, to);
  const node = nodeAround(state, name, from, to);
  if (!node) return null;
  // Inline code may open with several backticks.
  const size = style === 'code' ? /^`+/.exec(state.sliceDoc(node.from, node.to))![0].length : marker.length;
  return { from: node.from, to: node.to, size };
}

/** Wrap each range in the style's markers, or take them off when it already has them. */
function toggleInline(style: InlineStyle): StateCommand {
  return ({ state, dispatch }) => {
    const { marker } = INLINE[style];
    const size = marker.length;
    const spec = state.changeByRange((range) => {
      const pair = pairAround(state, style, range.from, range.to);
      if (pair) {
        const changes = state.changes([
          { from: pair.from, to: pair.from + pair.size },
          { from: pair.to - pair.size, to: pair.to },
        ]);
        return { changes, range: range.map(changes) };
      }
      if (range.empty) {
        // Pressing it twice with nothing typed takes the empty pair off again.
        const around = state.sliceDoc(range.from - size, range.from + size);
        if (around === marker + marker) {
          return { changes: { from: range.from - size, to: range.from + size }, range: EditorSelection.cursor(range.from - size) };
        }
        return { changes: { from: range.from, insert: marker + marker }, range: EditorSelection.cursor(range.from + size) };
      }
      // Markers must touch the text: spaces at either end of the selection stay outside them.
      const text = state.sliceDoc(range.from, range.to);
      const from = range.from + (text.length - text.trimStart().length);
      const to = range.to - (text.length - text.trimEnd().length);
      if (from >= to) return { range };
      return {
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        range: EditorSelection.range(from + size, to + size),
      };
    });
    dispatch(state.update(spec, { scrollIntoView: true, userEvent: USER_EVENT }));
    return true;
  };
}

/** Every line touched by the selection; a selection ending at a line's start leaves that line out. */
function selectedLines(state: EditorState) {
  const numbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    let last = state.doc.lineAt(range.to).number;
    if (!range.empty && state.doc.line(last).from === range.to) last--;
    for (let n = first; n <= last; n++) numbers.add(n);
  }
  return [...numbers].sort((a, b) => a - b).map((n) => state.doc.line(n));
}

const isBlank = (text: string) => text.trim() === '';

function listStyleOf(text: string) {
  return LIST_STYLES.find((style) => LINE_PATTERNS[style].test(text)) ?? null;
}

function applyLineChanges(state: EditorState, dispatch: (tr: Transaction) => void, changes: Array<{ from: number; to?: number; insert?: string }>) {
  const set = state.changes(changes);
  dispatch(state.update({ changes: set, selection: state.selection.map(set, 1), scrollIntoView: true, userEvent: USER_EVENT }));
  return true;
}

/** Make the lines this kind of list, turn another kind into it, or end the list when they all are it already. */
function toggleList(style: Exclude<LineStyle, 'quote'>): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state);
    const filled = lines.filter((line) => !isBlank(line.text));
    const remove = filled.length > 0 && filled.every((line) => listStyleOf(line.text) === style);
    // A lone empty line still becomes a list item; among other lines, blanks stay blank.
    const targets = filled.length > 0 ? filled : lines;
    const changes = targets.map((line, index) => {
      const current = listStyleOf(line.text);
      const match = current ? LINE_PATTERNS[current].exec(line.text)! : null;
      const indent = match ? match[1]! : '';
      const marker = style === 'bullet' ? '- ' : style === 'task' ? '- [ ] ' : `${index + 1}. `;
      return { from: line.from + indent.length, to: line.from + (match ? match[0].length : 0), insert: remove ? '' : marker };
    });
    return applyLineChanges(state, dispatch, changes);
  };
}

const toggleQuote: StateCommand = ({ state, dispatch }) => {
  const lines = selectedLines(state);
  const filled = lines.filter((line) => !isBlank(line.text));
  const remove = filled.length > 0 && filled.every((line) => QUOTE.test(line.text));
  const changes = (filled.length > 0 ? filled : lines).map((line) => {
    if (remove) return { from: line.from, to: line.from + QUOTE.exec(line.text)![0].length };
    return { from: line.from, insert: '> ' };
  });
  return applyLineChanges(state, dispatch, changes);
};

function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    const changes = selectedLines(state).map((line) => ({
      from: line.from,
      to: line.from + (HEADING.exec(line.text)?.[0].length ?? 0),
      insert: level > 0 ? `${'#'.repeat(level)} ` : '',
    }));
    return applyLineChanges(state, dispatch, changes);
  };
}

interface BlockOptions {
  /** End of the text being replaced; `from` when nothing is. */
  to?: number;
  /** What to select in the inserted text, counted from its start. The cursor goes after it by default. */
  select?: { from: number; to: number };
}

/** A transaction putting `text` on its own block at `from`: blank lines are added only where missing. */
export function blockInsert(state: EditorState, text: string, from: number, { to = from, select }: BlockOptions = {}): TransactionSpec {
  const { doc } = state;
  const before = doc.sliceString(Math.max(0, from - 2), from);
  const after = doc.sliceString(to, Math.min(doc.length, to + 2));
  const prefix = from === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = to === doc.length || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const start = from + prefix.length;
  return {
    changes: { from, to, insert: `${prefix}${text}${suffix}` },
    selection: select ? { anchor: start + select.from, head: start + select.to } : { anchor: start + text.length },
    scrollIntoView: true,
  };
}

/** A template block at the cursor, after any selection. */
function insertTemplate(text: string, select: BlockOptions['select']): StateCommand {
  return ({ state, dispatch }) => {
    dispatch(state.update(blockInsert(state, text, state.selection.main.to, { select }), { userEvent: USER_EVENT }));
    return true;
  };
}

const TABLE = '| Column 1 | Column 2 |\n| --- | --- |\n| Text | Text |';
const DIAGRAM = '```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```';

/** A selection goes inside the fence; with none, the cursor does. */
const insertCodeBlock: StateCommand = ({ state, dispatch }) => {
  const { from, to, empty } = state.selection.main;
  const body = state.sliceDoc(from, to);
  const select = empty ? { from: 4, to: 4 } : { from: 4, to: 4 + body.length };
  dispatch(state.update(blockInsert(state, `\`\`\`\n${body}\n\`\`\``, from, { to, select }), { userEvent: USER_EVENT }));
  return true;
};

/** A selection becomes inline math; with none, a display block. */
const insertMath: StateCommand = ({ state, dispatch }) => {
  const { from, to, empty } = state.selection.main;
  if (empty) {
    dispatch(state.update(blockInsert(state, '$$\n\n$$', from, { select: { from: 3, to: 3 } }), { userEvent: USER_EVENT }));
    return true;
  }
  dispatch(
    state.update({
      changes: [
        { from, insert: '$' },
        { from: to, insert: '$' },
      ],
      selection: { anchor: from + 1, head: to + 1 },
      userEvent: USER_EVENT,
    }),
  );
  return true;
};

/** The selection becomes the link's text, or its target when it is a URL; the part left to fill in is selected. */
const insertLink: StateCommand = ({ state, dispatch }) => {
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);
  const isUrl = /^https?:\/\/\S+$/i.test(selected);
  const text = selected === '' || isUrl ? 'link text' : selected;
  const url = isUrl ? selected : 'https://';
  const insert = `[${text}](${url})`;
  const start = from + (isUrl || selected === '' ? 1 : text.length + 3);
  const end = start + (isUrl || selected === '' ? text.length : url.length);
  dispatch(state.update({ changes: { from, to, insert }, selection: { anchor: start, head: end }, scrollIntoView: true, userEvent: USER_EVENT }));
  return true;
};

export const COMMANDS: Record<CommandId, StateCommand> = {
  undo,
  redo,
  bold: toggleInline('bold'),
  italic: toggleInline('italic'),
  strikethrough: toggleInline('strikethrough'),
  highlight: toggleInline('highlight'),
  code: toggleInline('code'),
  bullet: toggleList('bullet'),
  ordered: toggleList('ordered'),
  task: toggleList('task'),
  quote: toggleQuote,
  codeBlock: insertCodeBlock,
  divider: insertTemplate('---', undefined),
  link: insertLink,
  table: insertTemplate(TABLE, { from: 2, to: 10 }),
  math: insertMath,
  diagram: insertTemplate(DIAGRAM, undefined),
  heading0: setHeading(0),
  heading1: setHeading(1),
  heading2: setHeading(2),
  heading3: setHeading(3),
  heading4: setHeading(4),
  heading5: setHeading(5),
  heading6: setHeading(6),
};

export function editorStatus(state: EditorState): EditorStatus {
  const { from, to, head } = state.selection.main;
  const line = state.doc.lineAt(head);
  const inCodeBlock = nodeAround(state, 'FencedCode', from, to) !== null;
  const active: EditorStatus['active'] = [];
  if (inCodeBlock) {
    active.push('codeBlock');
  } else {
    active.push(...INLINE_STYLES.filter((style) => pairAround(state, style, from, to)));
    if (nodeAround(state, 'Link', from, to)) active.push('link');
    const list = listStyleOf(line.text);
    if (list) active.push(list);
    if (QUOTE.test(line.text)) active.push('quote');
  }
  return {
    active: active.sort(),
    heading: inCodeBlock ? 0 : (HEADING.exec(line.text)?.[1]?.length ?? 0),
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
  };
}

export const statusKey = (status: EditorStatus) => JSON.stringify(status);

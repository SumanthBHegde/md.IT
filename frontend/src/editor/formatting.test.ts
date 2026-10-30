import { history, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState, type StateCommand, type Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { blockInsert, COMMANDS, editorStatus, type CommandId } from './formatting';

/** Text with a selection: `|` marks the cursor, or two of them the selection. */
function stateOf(marked: string) {
  const from = marked.indexOf('|');
  const to = marked.lastIndexOf('|');
  const doc = marked.replaceAll('|', '');
  const selection = from === to ? EditorSelection.cursor(from) : EditorSelection.range(from, to - 1);
  return EditorState.create({ doc, selection, extensions: [history(), markdown({ base: markdownLanguage }), EditorState.allowMultipleSelections.of(true)] });
}

function apply(state: EditorState, command: StateCommand) {
  let next = state;
  command({ state, dispatch: (tr: Transaction) => (next = tr.state) });
  return next;
}

function marked(state: EditorState) {
  const { from, to } = state.selection.main;
  const doc = state.doc.toString();
  return from === to ? `${doc.slice(0, from)}|${doc.slice(from)}` : `${doc.slice(0, from)}|${doc.slice(from, to)}|${doc.slice(to)}`;
}

const run = (text: string, id: CommandId) => marked(apply(stateOf(text), COMMANDS[id]));
const active = (text: string) => editorStatus(stateOf(text)).active;

describe('inline styles', () => {
  it.each([
    ['bold', 'a |word| b', 'a **|word|** b'],
    ['italic', 'a |word| b', 'a *|word|* b'],
    ['strikethrough', 'a |word| b', 'a ~~|word|~~ b'],
    ['highlight', 'a |word| b', 'a ==|word|== b'],
    ['code', 'a |word| b', 'a `|word|` b'],
  ] as const)('%s wraps the selection', (id, before, after) => {
    expect(run(before, id)).toBe(after);
  });

  it.each([
    ['bold', 'a **|word|** b', 'a |word| b'],
    ['bold', 'a |**word**| b', 'a |word| b'],
    ['bold', 'a **wo|rd** b', 'a wo|rd b'],
    ['italic', 'a *|word|* b', 'a |word| b'],
    ['strikethrough', 'a ~~wo|rd~~ b', 'a wo|rd b'],
    ['highlight', 'a ==|word|== b', 'a |word| b'],
    ['highlight', 'a ==wo|rd== b', 'a wo|rd b'],
    ['code', 'a `wo|rd` b', 'a wo|rd b'],
    ['code', 'a ``wo|rd`` b', 'a wo|rd b'],
  ] as const)('%s unwraps %s', (id, before, after) => {
    expect(run(before, id)).toBe(after);
  });

  it('puts the cursor between the markers with nothing selected, and takes an empty pair off', () => {
    expect(run('a |', 'bold')).toBe('a **|**');
    expect(run('a **|**', 'bold')).toBe('a |');
  });

  it('keeps spaces at the ends of a selection outside the markers', () => {
    expect(run('a| word |b', 'bold')).toBe('a **|word|** b');
  });

  it('italic leaves bold text’s markers alone', () => {
    expect(run('|**word**|', 'italic')).toBe('*|**word**|*');
  });

  it('is one undo step', () => {
    const state = apply(apply(stateOf('|word|'), COMMANDS.bold), undo);
    expect(state.doc.toString()).toBe('word');
  });
});

describe('line styles', () => {
  it('turns every selected line into a list and numbers an ordered one', () => {
    expect(run('|one\ntwo|', 'bullet')).toBe('- |one\n- two|');
    expect(run('|one\ntwo|', 'ordered')).toBe('1. |one\n2. two|');
    expect(run('|one\ntwo|', 'task')).toBe('- [ ] |one\n- [ ] two|');
  });

  it('skips blank lines among others, and ignores a last line the selection only touches', () => {
    expect(run('|one\n\ntwo\n|three', 'bullet')).toBe('- |one\n\n- two\n|three');
  });

  it('starts a list on an empty line', () => {
    expect(run('|', 'bullet')).toBe('- |');
  });

  it('switches between kinds and keeps the indent', () => {
    expect(run('- on|e', 'ordered')).toBe('1. on|e');
    expect(run('1. on|e', 'task')).toBe('- [ ] on|e');
    expect(run('- [x] on|e', 'bullet')).toBe('- on|e');
    expect(run('  - on|e', 'ordered')).toBe('  1. on|e');
  });

  it('ends the list when every line already is that kind', () => {
    expect(run('|- one\n- two|', 'bullet')).toBe('|one\ntwo|');
    expect(run('- [ ] on|e', 'task')).toBe('on|e');
  });

  it('toggles a quote', () => {
    expect(run('|one\ntwo|', 'quote')).toBe('> |one\n> two|');
    expect(run('|> one\n> two|', 'quote')).toBe('|one\ntwo|');
  });

  it('sets, changes and clears a heading', () => {
    expect(run('Ti|tle', 'heading2')).toBe('## Ti|tle');
    expect(run('## Ti|tle', 'heading4')).toBe('#### Ti|tle');
    expect(run('## Ti|tle', 'heading0')).toBe('Ti|tle');
  });
});

describe('inserts', () => {
  it('puts blocks on their own lines', () => {
    expect(run('# Title|', 'divider')).toBe('# Title\n\n---|');
    expect(run('# Title|\n\nNext', 'divider')).toBe('# Title\n\n---|\n\nNext');
  });

  it('selects the first table header to overtype', () => {
    expect(run('|', 'table')).toBe('| |Column 1| | Column 2 |\n| --- | --- |\n| Text | Text |');
  });

  it('wraps a selection in a code block, or leaves the cursor inside a new one', () => {
    expect(run('|let a|', 'codeBlock')).toBe('```\n|let a|\n```');
    expect(run('|', 'codeBlock')).toBe('```\n|\n```');
  });

  it('makes a selection inline math, and otherwise a display block', () => {
    expect(run('so |x^2| is', 'math')).toBe('so $|x^2|$ is');
    expect(run('|', 'math')).toBe('$$\n|\n$$');
  });

  it('inserts a Mermaid diagram', () => {
    expect(run('|', 'diagram')).toContain('```mermaid\nflowchart TD');
  });

  it('links a selection and selects the address to fill in', () => {
    expect(run('see |docs| now', 'link')).toBe('see [docs](|https://|) now');
    expect(run('|', 'link')).toBe('[|link text|](https://)');
    expect(run('|https://a.dev|', 'link')).toBe('[|link text|](https://a.dev)');
  });

  it('blockInsert selects inside the inserted text when asked', () => {
    const state = stateOf('a|');
    const next = state.update(blockInsert(state, 'xyz', 1, { select: { from: 1, to: 2 } })).state;
    expect(marked(next)).toBe('a\n\nx|y|z');
  });
});

describe('editorStatus', () => {
  it('reports inline styles at the cursor', () => {
    expect(active('a **wo|rd** b')).toEqual(['bold']);
    expect(active('a *wo|rd* b')).toEqual(['italic']);
    expect(active('a ~~wo|rd~~ b')).toEqual(['strikethrough']);
    expect(active('a ==wo|rd== b')).toEqual(['highlight']);
    expect(active('a `wo|rd` b')).toEqual(['code']);
    expect(active('[wo|rd](https://a.dev)')).toEqual(['link']);
    expect(active('plain wo|rd')).toEqual([]);
  });

  it('reports styles that nest', () => {
    expect(active('**a *wo|rd* b**')).toEqual(['bold', 'italic']);
  });

  it('reports the line’s list and quote', () => {
    expect(active('- on|e')).toEqual(['bullet']);
    expect(active('1. on|e')).toEqual(['ordered']);
    expect(active('- [ ] on|e')).toEqual(['task']);
    expect(active('> on|e')).toEqual(['quote']);
  });

  it('reports the heading level', () => {
    expect(editorStatus(stateOf('### Ti|tle')).heading).toBe(3);
    expect(editorStatus(stateOf('Ti|tle')).heading).toBe(0);
  });

  it('inside a code block reports only that', () => {
    const status = editorStatus(stateOf('```\n# not a heading **|x**\n```'));
    expect(status.active).toEqual(['codeBlock']);
    expect(status.heading).toBe(0);
  });

  it('follows undo and redo', () => {
    const start = stateOf('|word|');
    expect(editorStatus(start).canUndo).toBe(false);
    const edited = apply(start, COMMANDS.bold);
    expect(editorStatus(edited).canUndo).toBe(true);
    expect(editorStatus(apply(edited, COMMANDS.undo)).canRedo).toBe(true);
  });
});

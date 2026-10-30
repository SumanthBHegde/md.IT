import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/** Editor chrome from design tokens (code-editor type style: 14/24 Geist Mono). */
export const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--paper-raised)', color: 'var(--ink)' },
  '&.cm-focused': { outline: '2px solid var(--focus)', outlineOffset: '-2px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '14px', lineHeight: '24px', overflow: 'auto' },
  '.cm-content': { padding: 'var(--space-6) var(--space-6) var(--space-16)', caretColor: 'var(--accent)', maxWidth: 'var(--doc-measure)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--accent-soft)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  // Find and replace: search matches are the marker's job (design system, color).
  '.cm-searchMatch': { backgroundColor: 'var(--marker)', outline: 'none' },
  '.cm-searchMatch.cm-searchMatch-selected, .cm-searchMatch-selected span': { backgroundColor: 'var(--marker)', outline: '2px solid var(--accent)' },
  '.cm-panels': { backgroundColor: 'var(--paper-sunken)', color: 'var(--ink)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
  '.cm-panel.cm-search': { padding: 'var(--space-2) var(--space-8) var(--space-2) var(--space-3)', font: '400 12px/16px var(--font-sans)', color: 'var(--ink-muted)' },
  '.cm-panel.cm-search label': { fontSize: '12px', color: 'var(--ink-muted)' },
  '.cm-panel.cm-search input[type=checkbox]': { accentColor: 'var(--accent)' },
  '.cm-panel.cm-search button[name=close]': { top: 'var(--space-2)', right: 'var(--space-2)', fontSize: '16px', color: 'var(--ink-muted)' },
  '.cm-textfield': {
    height: 'var(--control-sm)',
    boxSizing: 'border-box',
    padding: '0 var(--space-2)',
    border: '1px solid var(--line-strong)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--paper-raised)',
    color: 'var(--ink)',
    font: '400 13px/18px var(--font-sans)',
  },
  '.cm-textfield:focus': { outline: '2px solid var(--focus)', outlineOffset: '1px' },
  '.cm-button': {
    height: 'var(--control-sm)',
    padding: '0 var(--space-2)',
    border: '1px solid var(--line-strong)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--paper-raised)',
    backgroundImage: 'none',
    color: 'var(--ink)',
    font: '500 12px/16px var(--font-sans)',
  },
  '.cm-button:hover': { backgroundColor: 'var(--paper-sunken)' },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--paper-sunken)' },
  '.cm-button:focus-visible': { outline: '2px solid var(--focus)', outlineOffset: '2px' },
});

/** Muted Markdown syntax colors: structure in ink, markup characters faint. */
export const markdownHighlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '600', color: 'var(--ink)' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--link)' },
  { tag: t.monospace, color: 'var(--ink-muted)' },
  { tag: t.quote, color: 'var(--ink-muted)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator, t.labelName], color: 'var(--ink-faint)' },
]);

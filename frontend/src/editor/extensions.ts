import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, keymap, type KeyBinding } from '@codemirror/view';
import { imageFiles } from './files';
import { COMMANDS, type CommandId } from './formatting';
import { EDITOR_KEYS, REPLACE_KEY } from './shortcuts';
import { editorTheme, markdownHighlight } from './theme';

export interface EditorCallbacks {
  onChange: (content: string) => void;
  onSave: () => void;
  onImageFiles: (files: File[], at: number | null) => void;
  onFocus: () => void;
  /** The text or the selection changed. */
  onUpdate: (state: EditorState) => void;
}

const formatKeys: KeyBinding[] = (Object.entries(EDITOR_KEYS) as Array<[CommandId, string]>).map(([id, key]) => ({
  key,
  preventDefault: true,
  run: COMMANDS[id],
}));

/** The search panel's words in the design system's sentence case. */
const searchPhrases = EditorState.phrases.of({
  next: 'Next',
  previous: 'Previous',
  all: 'All',
  'match case': 'Match case',
  'by word': 'Whole word',
  regexp: 'Regular expression',
  replace: 'Replace',
  'replace all': 'Replace all',
  close: 'Close',
});

export function createExtensions({ onChange, onSave, onImageFiles, onFocus, onUpdate }: EditorCallbacks): Extension[] {
  return [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }), // GFM
    syntaxHighlighting(markdownHighlight),
    search({ top: true }),
    searchPhrases,
    keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => (onSave(), true) },
      { key: REPLACE_KEY, preventDefault: true, run: openSearchPanel },
      ...formatKeys, // before the defaults: Mod-i would otherwise select the parent syntax node
      ...searchKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString());
      if (update.docChanged || update.selectionSet) onUpdate(update.state);
    }),
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown source' }),
    EditorView.domEventHandlers({
      focus: () => {
        onFocus();
        return false;
      },
      drop: (event, view) => {
        const files = imageFiles(event.dataTransfer?.files);
        if (files.length === 0) return false;
        event.preventDefault();
        onImageFiles(files, view.posAtCoords({ x: event.clientX, y: event.clientY }));
        return true;
      },
      paste: (event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (files.length === 0) return false;
        event.preventDefault();
        onImageFiles(files, null);
        return true;
      },
    }),
    editorTheme,
  ];
}

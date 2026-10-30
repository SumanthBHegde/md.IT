import { EDITOR_KEYS, FIND_KEY, keyParts, REPLACE_KEY } from '../editor';
import { Button, Dialog, Kbd } from '../ui';

interface Shortcut {
  label: string;
  key: string;
}

const GROUPS: ReadonlyArray<{ title: string; shortcuts: readonly Shortcut[] }> = [
  {
    title: 'Formatting',
    shortcuts: [
      { label: 'Bold', key: EDITOR_KEYS.bold! },
      { label: 'Italic', key: EDITOR_KEYS.italic! },
      { label: 'Strikethrough', key: EDITOR_KEYS.strikethrough! },
      { label: 'Highlight', key: EDITOR_KEYS.highlight! },
      { label: 'Inline code', key: EDITOR_KEYS.code! },
      { label: 'Link', key: EDITOR_KEYS.link! },
      { label: 'Normal text', key: EDITOR_KEYS.heading0! },
      { label: 'Heading 1 to 6', key: 'Mod-Alt-1…6' },
      { label: 'Numbered list', key: EDITOR_KEYS.ordered! },
      { label: 'Bulleted list', key: EDITOR_KEYS.bullet! },
      { label: 'Checklist', key: EDITOR_KEYS.task! },
    ],
  },
  {
    title: 'Editing',
    shortcuts: [
      { label: 'Undo', key: EDITOR_KEYS.undo! },
      { label: 'Redo', key: EDITOR_KEYS.redo! },
      { label: 'Find', key: FIND_KEY },
      { label: 'Replace', key: REPLACE_KEY },
    ],
  },
  {
    title: 'Workspace',
    shortcuts: [
      { label: 'Save in this browser', key: 'Mod-s' },
      { label: 'Save version', key: 'Mod-Shift-s' },
      { label: 'Search this project', key: 'Mod-Shift-f' },
      { label: 'Show or hide the file tree', key: 'Mod-\\' },
      { label: 'Keyboard shortcuts', key: 'F1' },
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} actions={<Button onClick={onClose}>Close</Button>}>
      <div className="shortcuts">
        {GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="panel-heading">{group.title}</h3>
            <ul className="shortcuts-list">
              {group.shortcuts.map((shortcut) => (
                <li key={shortcut.label} className="shortcuts-row">
                  <span>{shortcut.label}</span>
                  <span className="shortcuts-keys">
                    {keyParts(shortcut.key).map((part) => (
                      <Kbd key={part}>{part}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

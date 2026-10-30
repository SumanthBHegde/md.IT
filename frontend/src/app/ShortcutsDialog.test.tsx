import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShortcutsDialog } from './ShortcutsDialog';

describe('ShortcutsDialog', () => {
  it('lists shortcuts in groups, as separate keys', () => {
    render(<ShortcutsDialog onClose={vi.fn()} />);
    const formatting = within(screen.getByRole('region', { name: 'Formatting' }));
    const bold = formatting.getByText('Bold').closest('li')!;
    expect([...bold.querySelectorAll('kbd')].map((kbd) => kbd.textContent)).toEqual(['Ctrl', 'B']);
    expect(formatting.getByText('Heading 1 to 6')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Editing' })).toHaveTextContent('Replace');
    expect(screen.getByRole('region', { name: 'Workspace' })).toHaveTextContent('Save version');
  });

  it('never repeats a key within a row', () => {
    render(<ShortcutsDialog onClose={vi.fn()} />);
    for (const row of document.querySelectorAll('.shortcuts-row')) {
      const keys = [...row.querySelectorAll('kbd')].map((kbd) => kbd.textContent);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

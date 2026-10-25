import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConflictDialog } from './ConflictDialog';
import { SaveVersionDialog } from './SaveVersionDialog';

describe('SaveVersionDialog', () => {
  it('sends null for a blank message and shows Saving… while it runs', async () => {
    let finish!: () => void;
    const onSave = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const onClose = vi.fn();
    render(<SaveVersionDialog onSave={onSave} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('Message (optional)'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Save version' }));
    expect(onSave).toHaveBeenCalledWith(null);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('sends the message', async () => {
    const onSave = vi.fn(async () => {});
    render(<SaveVersionDialog onSave={onSave} onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Message (optional)'), 'First draft');
    await userEvent.click(screen.getByRole('button', { name: 'Save version' }));
    expect(onSave).toHaveBeenCalledWith('First draft');
  });

  it('limits the message to 500 characters', () => {
    render(<SaveVersionDialog onSave={async () => {}} onClose={() => {}} />);
    expect(screen.getByLabelText('Message (optional)')).toHaveAttribute('maxlength', '500');
  });
});

describe('ConflictDialog', () => {
  it('shows the conflict copy with the version number and three actions', async () => {
    const onLoadLatest = vi.fn(async () => {});
    const onSaveCopy = vi.fn(async () => {});
    const onClose = vi.fn();
    render(<ConflictDialog latestNumber={4} onLoadLatest={onLoadLatest} onSaveCopy={onSaveCopy} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'A newer version exists' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Version 4 was saved from another browser or tab after this document was last saved or loaded. Load it, or save yours as a copy.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save mine as a copy' }));
    expect(onSaveCopy).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Load latest' }));
    expect(onLoadLatest).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});

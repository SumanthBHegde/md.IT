import { useId, useState, type FormEvent } from 'react';
import { Button, Dialog, Input } from '../ui';

export interface SaveVersionDialogProps {
  /** Resolves when the save is over (whatever the outcome; failures become workspace notices). */
  onSave: (message: string | null) => Promise<void>;
  onClose: () => void;
}

/** "Save version" (PRD 6.2): an explicit save with an optional message, like a commit. */
export function SaveVersionDialog({ onSave, onClose }: SaveVersionDialogProps) {
  const formId = useId();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave(message.trim() ? message : null);
    } finally {
      onClose();
    }
  };

  return (
    <Dialog
      title="Save version"
      onClose={busy ? undefined : onClose}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" icon="cloud" disabled={busy}>
            {busy ? 'Saving…' : 'Save version'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)}>
        <Input
          label="Message (optional)"
          hint="What changed, in a few words."
          value={message}
          maxLength={500}
          onChange={(event) => setMessage(event.target.value)}
        />
      </form>
    </Dialog>
  );
}

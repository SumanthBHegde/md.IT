import { useState } from 'react';
import { Button, Dialog } from '../ui';

export interface ConflictDialogProps {
  latestNumber: number;
  onLoadLatest: () => Promise<void>;
  onSaveCopy: () => Promise<void>;
  onClose: () => void;
}

/** Another browser saved first (PRD 6.3, P-080): load theirs, or keep mine as a copy. No merging. */
export function ConflictDialog({ latestNumber, onLoadLatest, onSaveCopy, onClose }: ConflictDialogProps) {
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="A newer version exists"
      onClose={busy ? undefined : onClose}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void run(onSaveCopy)()} disabled={busy}>
            Save mine as a copy
          </Button>
          <Button variant="primary" onClick={() => void run(onLoadLatest)()} disabled={busy}>
            Load latest
          </Button>
        </>
      }
    >
      <p>
        Version {latestNumber} was saved from another browser or tab after this document was last saved or loaded. Load it, or save yours as a
        copy.
      </p>
    </Dialog>
  );
}

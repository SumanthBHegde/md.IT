import { useEffect, useState } from 'react';
import { parseProjectZip, type ParsedProjectZip } from '../export';
import { plural } from '../lib/text';
import { clampRendering, sameRendering } from '../settings';
import { getSetting, importProject, setSetting, SETTINGS, userMessage } from '../store';
import { Button, Dialog } from '../ui';

type State = { status: 'reading' } | { status: 'ready'; parsed: ParsedProjectZip; differs: boolean } | { status: 'failed'; message: string };

export interface ImportDialogProps {
  file: File;
  onClose: () => void;
  onImported: (projectId: string, notice?: string) => void;
}

const SHOWN_SKIPS = 5;

export function ImportDialog({ file, onClose, onImported }: ImportDialogProps) {
  const [state, setState] = useState<State>({ status: 'reading' });
  const [useSettings, setUseSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const parsed = await parseProjectZip(new Uint8Array(await file.arrayBuffer()), file.name);
        const current = clampRendering(await getSetting<unknown>(SETTINGS.rendering, null));
        const differs = parsed.rendering !== null && !sameRendering(parsed.rendering, current);
        if (!cancelled) setState({ status: 'ready', parsed, differs });
      } catch (err) {
        if (!cancelled) setState({ status: 'failed', message: userMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (state.status === 'reading') {
    return (
      <Dialog title="Import project" onClose={onClose}>
        <p aria-busy="true">Reading “{file.name}”…</p>
      </Dialog>
    );
  }
  if (state.status === 'failed') {
    return (
      <Dialog title={`Couldn’t import ${file.name}`} onClose={onClose} actions={<Button onClick={onClose}>Close</Button>}>
        <p>{state.message}</p>
      </Dialog>
    );
  }

  const { parsed, differs } = state;
  const skipped = parsed.skipped.length;
  const renamed = parsed.renamed.length;
  const submit = async () => {
    setBusy(true);
    setError(null);
    let projectId: string;
    try {
      projectId = (await importProject(parsed)).id;
    } catch (err) {
      setError(userMessage(err));
      setBusy(false);
      return;
    }
    // The project exists from here on: a failure below must not offer a retry that would import it twice.
    let notice: string | undefined;
    if (useSettings && parsed.rendering) {
      try {
        await setSetting(SETTINGS.rendering, parsed.rendering);
      } catch {
        notice = 'Imported the project, but its rendering settings couldn’t be applied.';
      }
    }
    onImported(projectId, notice);
  };

  return (
    <Dialog
      title={`Import “${parsed.name}”`}
      onClose={busy ? undefined : onClose}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            Import
          </Button>
        </>
      }
    >
      <p>{`${plural(parsed.documents.length, 'document')}, ${plural(parsed.images.length, 'image')}, ${plural(parsed.folders.length, 'folder')}`}</p>
      {skipped > 0 && (
        <>
          <p>{skipped === 1 ? '1 file wasn’t imported:' : `${skipped} files weren’t imported:`}</p>
          <ul className="import-skipped">
            {parsed.skipped.slice(0, SHOWN_SKIPS).map((s) => (
              <li key={s.path}>{`${s.path} — ${s.reason}`}</li>
            ))}
          </ul>
          {skipped > SHOWN_SKIPS && <p>{`and ${skipped - SHOWN_SKIPS} more`}</p>}
        </>
      )}
      {renamed > 0 && <p>{renamed === 1 ? '1 name was changed to avoid duplicates.' : `${renamed} names were changed to avoid duplicates.`}</p>}
      {differs && (
        <label className="md-check">
          <input type="checkbox" checked={useSettings} onChange={(event) => setUseSettings(event.currentTarget.checked)} />
          Use its rendering settings
        </label>
      )}
      {error && (
        <p className="md-field-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

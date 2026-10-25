import { useState, type CSSProperties } from 'react';
import type { VersionSummary } from '../api';
import { ConfirmDialog } from '../dialogs';
import { formatRelativeTime } from '../lib/time';
import { Preview, type Theme } from '../preview';
import { Button } from '../ui';

export interface VersionViewerProps {
  version: VersionSummary;
  html: string;
  theme: Theme;
  proseStyle?: CSSProperties;
  onRestore: () => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
  onNotice: (message: string) => void;
}

/** A saved version, read-only, in place of the editor and preview (P-081). */
export function VersionViewer({ version, html, theme, proseStyle, onRestore, onDelete, onClose, onNotice }: VersionViewerProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const restore = async () => {
    setBusy(true);
    try {
      await onRestore();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ws-version" aria-label={`Version ${version.number}`}>
      <header className="ws-version-head">
        <div className="ws-version-title">
          <strong>Version {version.number} · read-only</strong>
          <span className="ws-version-meta">
            {version.message ? `${version.message} · ` : ''}
            {formatRelativeTime(Date.parse(version.created_at))}
          </span>
        </div>
        <div className="ws-version-actions">
          <Button variant="primary" onClick={() => void restore()} disabled={busy}>
            Restore
          </Button>
          <Button variant="danger" onClick={() => setConfirming(true)} disabled={busy}>
            Delete
          </Button>
          <Button onClick={onClose} disabled={busy}>
            Close
          </Button>
        </div>
      </header>
      <div className="ws-version-body">
        {/* No document links here: it is a past state, and the open document stays where it is. */}
        <Preview html={html} theme={theme} style={proseStyle} onOpenDocument={() => {}} onNotice={onNotice} />
      </div>
      {confirming && (
        <ConfirmDialog
          title="Delete version"
          message={`Delete version ${version.number}? This can’t be undone.`}
          confirmLabel="Delete version"
          onClose={() => setConfirming(false)}
          onConfirm={onDelete}
        />
      )}
    </section>
  );
}

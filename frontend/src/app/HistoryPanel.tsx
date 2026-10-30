import { useEffect, useState } from 'react';
import type { VersionSummary } from '../api';
import { formatRelativeTime } from '../lib/time';
import { listVersions } from '../sync';
import { Callout, EmptyState, VersionItem } from '../ui';

export interface HistoryPanelProps {
  docId: string | undefined;
  headVersionId: string | undefined;
  signedIn: boolean;
  /** Bumped after every save, load, restore or delete. */
  refreshKey: number;
  onOpen: (version: VersionSummary) => void;
}

type Listing = { status: 'loading' } | { status: 'none' } | { status: 'error' } | { status: 'ready'; versions: VersionSummary[] };

/** The History tab (spec 5b 6.5, P-081): this document's saved versions, newest first. */
export function HistoryPanel({ docId, headVersionId, signedIn, refreshKey, onOpen }: HistoryPanelProps) {
  const [listing, setListing] = useState<Listing>({ status: 'loading' });

  useEffect(() => {
    if (!signedIn || !docId) return;
    let cancelled = false;
    setListing({ status: 'loading' });
    listVersions(docId).then(
      (versions) => {
        if (cancelled) return;
        setListing(versions === null || versions.length === 0 ? { status: 'none' } : { status: 'ready', versions });
      },
      () => {
        if (!cancelled) setListing({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [docId, signedIn, refreshKey]);

  if (!signedIn) {
    return (
      <EmptyState icon="history" title="Sign in to keep versions">
        Saved versions live in your md.IT account and open on any browser.
      </EmptyState>
    );
  }
  if (!docId) {
    return <EmptyState icon="history" title="No document open" />;
  }
  if (listing.status === 'loading') return <div className="history-list" aria-busy="true" />;
  if (listing.status === 'error') return <Callout tone="warning">Couldn’t load versions.</Callout>;
  if (listing.status === 'none') {
    return (
      <EmptyState icon="history" title="No versions yet">
        Save version keeps a copy of this document in your account.
      </EmptyState>
    );
  }
  return (
    <ul className="history-list" aria-label="Versions">
      {listing.versions.map((version) => (
        <li key={version.id}>
          <VersionItem
            number={version.number}
            message={version.message}
            time={formatRelativeTime(Date.parse(version.created_at))}
            current={version.id === headVersionId}
            onClick={() => onOpen(version)}
          />
        </li>
      ))}
    </ul>
  );
}

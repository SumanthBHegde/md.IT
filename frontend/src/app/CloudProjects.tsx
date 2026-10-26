import { useEffect, useMemo, useState } from 'react';
import { ApiError, type ProjectOut } from '../api';
import { useAuth } from '../auth';
import { plural } from '../lib/text';
import { formatRelativeTime } from '../lib/time';
import { StoreError, useProjectSummaries, userMessage } from '../store';
import { downloadProject, listCloudProjects } from '../sync';
import { Button, Callout } from '../ui';

type Listing = { status: 'loading' } | { status: 'error' } | { status: 'ready'; projects: ProjectOut[] };

export interface CloudProjectsProps {
  onDownloaded: (projectId: string, notice: string) => void;
}

/** "In your account" (spec 5b 6.6, P-082): cloud projects not yet in this browser. */
export function CloudProjects({ onDownloaded }: CloudProjectsProps) {
  const auth = useAuth();
  const local = useProjectSummaries();
  const [listing, setListing] = useState<Listing>({ status: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signedIn = auth.state === 'signed-in';

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    listCloudProjects().then(
      (projects) => !cancelled && setListing({ status: 'ready', projects }),
      () => !cancelled && setListing({ status: 'error' }),
    );
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const linked = useMemo(() => new Set((local ?? []).map((p) => p.cloudProjectId).filter((id) => id !== undefined)), [local]);
  if (!signedIn || local === undefined) return null;

  const download = async (project: ProjectOut) => {
    setBusyId(project.id);
    setError(null);
    try {
      const { projectId, documents, skipped } = await downloadProject(project);
      const notice = `Downloaded ${plural(documents, 'document')}.${skipped.length > 0 ? ` Skipped: ${skipped.join(', ')}.` : ''}`;
      onDownloaded(projectId, notice);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) auth.sessionEnded();
      const reason = err instanceof ApiError || err instanceof StoreError ? err.message : userMessage(err);
      setError(`Couldn’t download “${project.name}”: ${reason}`);
      setBusyId(null);
    }
  };

  const shown = listing.status === 'ready' ? listing.projects.filter((project) => !linked.has(project.id)) : [];
  return (
    <section className="cloud-projects" aria-labelledby="cloud-projects-title">
      <h2 id="cloud-projects-title">In your account</h2>
      {listing.status === 'loading' && <div className="cloud-projects-busy" aria-busy="true" />}
      {listing.status === 'error' && <Callout tone="warning">Couldn’t load your account’s projects.</Callout>}
      {error && <Callout tone="danger">{error}</Callout>}
      {listing.status === 'ready' && shown.length === 0 && <p className="cloud-projects-empty">Everything in your account is in this browser.</p>}
      {shown.length > 0 && (
        <ul className="project-list">
          {shown.map((project) => (
            <li key={project.id} className="project-row cloud-project-row">
              <span className="project-open">
                <span className="project-name">{project.name}</span>
                <span className="project-meta">
                  {plural(project.document_count, 'document')} · saved {formatRelativeTime(Date.parse(project.created_at))}
                </span>
              </span>
              <Button
                icon="download"
                aria-label={`Download ${project.name}`}
                disabled={busyId !== null}
                onClick={() => void download(project)}
              >
                {busyId === project.id ? 'Downloading…' : 'Download'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

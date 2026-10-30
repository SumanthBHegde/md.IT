import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ConfirmDialog, TextFieldDialog } from '../dialogs';
import { exportProject } from '../export';
import { plural } from '../lib/text';
import { formatRelativeTime } from '../lib/time';
import {
  createProject, deleteProject, renameProject, setProjectDescription, useProjectSummaries, userMessage, type ProjectSummary,
} from '../store';
import { Button, Callout, EmptyState, IconButton, MenuButton, Wordmark } from '../ui';
import { AccountMenu } from './AccountMenu';
import { CloudProjects } from './CloudProjects';
import { ImportDialog } from './ImportDialog';
import { StorageWarning } from './StorageWarning';
import { ThemeMenu } from './ThemeMenu';

type ProjectDialog =
  | { kind: 'create' }
  | { kind: 'rename'; project: ProjectSummary }
  | { kind: 'describe'; project: ProjectSummary }
  | { kind: 'delete'; project: ProjectSummary }
  | { kind: 'import'; file: File }
  | null;

function deleteMessage(project: ProjectSummary): string {
  const contents = project.documentCount > 0 ? ` and its ${plural(project.documentCount, 'document')}` : '';
  return `Delete “${project.name}”${contents}? This can’t be undone.`;
}

export function ProjectList() {
  const projects = useProjectSummaries();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<ProjectDialog>(null);
  const close = () => setDialog(null);
  const open = (id: string) => navigate(`/p/${id}`);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const exportZip = (project: ProjectSummary) =>
    void exportProject(project.id).catch((err: unknown) => setError(`Couldn’t export: ${userMessage(err)}`));
  const newProjectButton = (
    <Button variant="primary" icon="plus" onClick={() => setDialog({ kind: 'create' })}>
      New project
    </Button>
  );

  return (
    <div className="page">
      <header className="app-toolbar">
        <Wordmark />
        <span className="app-toolbar-spacer" />
        <AccountMenu />
        <ThemeMenu />
      </header>
      <main className="projects">
        <StorageWarning />
        <div className="projects-head">
          <h1>Projects</h1>
          <div className="projects-actions">
            <Button onClick={() => importInputRef.current?.click()}>Import project</Button>
            {projects && projects.length > 0 && newProjectButton}
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            tabIndex={-1}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) setDialog({ kind: 'import', file });
            }}
          />
        </div>
        {error && (
          <Callout tone="danger" actions={<IconButton icon="x" label="Dismiss" onClick={() => setError(null)} />}>
            {error}
          </Callout>
        )}
        {projects?.length === 0 && (
          <EmptyState icon="folder" title="No projects yet" action={newProjectButton}>
            Projects live in this browser. Create one to start writing.
          </EmptyState>
        )}
        {projects && projects.length > 0 && (
          <ul className="project-list">
            {projects.map((project) => (
              <li key={project.id} className="project-row">
                <button type="button" className="project-open" onClick={() => open(project.id)}>
                  <span className="project-name">{project.name}</span>
                  {project.description && <span className="project-desc">{project.description}</span>}
                  <span className="project-meta">
                    {plural(project.documentCount, 'document')} · Updated {formatRelativeTime(project.updatedAt)}
                  </span>
                </button>
                <MenuButton
                  label={`Actions for ${project.name}`}
                  items={[
                    { label: 'Open', icon: 'folder-open', onSelect: () => open(project.id) },
                    { label: 'Rename', icon: 'pencil', onSelect: () => setDialog({ kind: 'rename', project }) },
                    { label: 'Edit description', onSelect: () => setDialog({ kind: 'describe', project }) },
                    { label: 'Export .zip', icon: 'download', onSelect: () => exportZip(project) },
                    'separator',
                    { label: 'Delete', icon: 'trash', danger: true, onSelect: () => setDialog({ kind: 'delete', project }) },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
        <CloudProjects onDownloaded={(projectId, notice) => navigate(`/p/${projectId}`, { state: { notice } })} />
      </main>

      {dialog?.kind === 'create' && (
        <TextFieldDialog
          title="New project"
          label="Name"
          submitLabel="Create project"
          onClose={close}
          onSubmit={async (name) => {
            const project = await createProject(name);
            open(project.id);
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <TextFieldDialog
          title="Rename project"
          label="Name"
          submitLabel="Rename"
          initialValue={dialog.project.name}
          onClose={close}
          onSubmit={async (name) => {
            await renameProject(dialog.project.id, name);
          }}
        />
      )}
      {dialog?.kind === 'describe' && (
        <TextFieldDialog
          title="Edit description"
          label="Description"
          submitLabel="Save description"
          initialValue={dialog.project.description}
          onClose={close}
          onSubmit={async (text) => {
            await setProjectDescription(dialog.project.id, text);
          }}
        />
      )}
      {dialog?.kind === 'import' && (
        <ImportDialog
          file={dialog.file}
          onClose={close}
          onImported={(id, notice) => {
            close();
            navigate(`/p/${id}`, { state: { notice } });
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete project"
          message={deleteMessage(dialog.project)}
          confirmLabel="Delete project"
          onClose={close}
          onConfirm={() => deleteProject(dialog.project.id)}
        />
      )}
    </div>
  );
}

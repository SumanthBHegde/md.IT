import { EditorView } from '@codemirror/view';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi, setApi } from '../api';
import { AuthProvider } from '../auth';
import { addImage, clearDatabase, createDocument, createProject, getDocument, saveDocumentContent } from '../store';
import { createFakeApi, type FakeApi } from '../test/fakeApi';
import { Workspace } from './Workspace';

let fake: FakeApi;

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname}</output>;
}

function renderAt(path: string, assign = vi.fn()) {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider assign={assign}>
        <Routes>
          <Route path="/p/:projectId" element={<Workspace />} />
          <Route path="/p/:projectId/d/:docId" element={<Workspace />} />
        </Routes>
        <Where />
      </AuthProvider>
    </MemoryRouter>,
  );
  return { ...view, assign };
}

async function projectWithDocument(content = '# Hello\n\nWorld') {
  const project = await createProject('OS');
  const doc = await createDocument(project.id, null, 'Intro');
  await saveDocumentContent(doc.id, content);
  return { project, doc };
}

const editor = (container: HTMLElement) => EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;
const editorText = (container: HTMLElement) => editor(container).state.doc.toString();
const statusText = () => screen.getAllByRole('status').map((el) => el.textContent ?? '').join(' | ');

function type(container: HTMLElement, text: string) {
  const view = editor(container);
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: text } }));
}

async function saveVersionNow(message?: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Save version' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Save version' }));
  if (message) await userEvent.type(dialog.getByLabelText('Message (optional)'), message);
  await userEvent.click(dialog.getByRole('button', { name: 'Save version' }));
  // The dialog closes once the save is over; the next step must not race it.
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save version' })).not.toBeInTheDocument());
}

beforeEach(async () => {
  await clearDatabase();
  fake = createFakeApi();
  setApi(createApi(fake.fetch));
});

describe('Workspace versions', () => {
  it('shows Save version only when signed in', async () => {
    const { project, doc } = await projectWithDocument();
    renderAt(`/p/${project.id}/d/${doc.id}`);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save version' })).not.toBeInTheDocument();
  });

  it('saves a version and shows Version saved · v1 until the next edit', async () => {
    fake.signIn();
    const { project, doc } = await projectWithDocument();
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await saveVersionNow('First');
    await waitFor(() => expect(statusText()).toContain('Version saved· v1'));
    expect([...fake.versions.values()][0]).toMatchObject({ number: 1, message: 'First' });
    type(container, '\n\nMore');
    await waitFor(() => expect(statusText()).not.toContain('Version saved'));
  });

  it('Ctrl+Shift+S opens the save dialog', async () => {
    fake.signIn();
    const { project, doc } = await projectWithDocument();
    renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByRole('button', { name: 'Save version' });
    fireEvent.keyDown(window, { key: 'S', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('dialog', { name: 'Save version' })).toBeInTheDocument();
  });

  it('saves the last keystroke, not only the last autosave', async () => {
    fake.signIn();
    const { project, doc } = await projectWithDocument();
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByRole('button', { name: 'Save version' });
    type(container, '\n\nJust typed');
    await saveVersionNow();
    await waitFor(() => expect(fake.versions.size).toBe(1));
    const version = [...fake.versions.values()][0]!;
    expect(new TextDecoder().decode(fake.blobs.get(version.content_hash)!.bytes)).toBe('# Hello\n\nWorld\n\nJust typed');
  });

  it('opens the conflict dialog on 409; Load latest replaces the editor text', async () => {
    fake.signIn();
    const { project, doc } = await projectWithDocument();
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await saveVersionNow();
    await waitFor(() => expect(fake.versions.size).toBe(1));
    fake.addVersion((await getDocument(doc.id))!.cloudDocumentId!, '# From the other browser');
    type(container, '\n\nMine');
    await saveVersionNow();
    expect(await screen.findByRole('dialog', { name: 'A newer version exists' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load latest' }));
    await waitFor(() => expect(editorText(container)).toBe('# From the other browser'));
    expect(statusText()).toContain('Loaded version 2.');
  });

  it('Save mine as a copy opens the copy with the notice', async () => {
    fake.signIn();
    const { project, doc } = await projectWithDocument();
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await saveVersionNow();
    await waitFor(() => expect(fake.versions.size).toBe(1));
    fake.addVersion((await getDocument(doc.id))!.cloudDocumentId!, '# From the other browser');
    type(container, '\n\nMine');
    await saveVersionNow();
    await userEvent.click(await screen.findByRole('button', { name: 'Save mine as a copy' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).not.toBe(`/p/${project.id}/d/${doc.id}`));
    await waitFor(() => expect(editorText(container)).toBe('# Hello\n\nWorld\n\nMine'));
    expect(statusText()).toContain('Saved your changes as “Intro copy.md”. “Intro.md” now has the latest version.');
    expect((await getDocument(doc.id))!.content).toBe('# From the other browser');
  });

  it('Load latest stores a pending edit first, so autosave can’t overwrite the loaded text', async () => {
    fake.signIn();
    const { project, doc } = await projectWithDocument();
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await saveVersionNow();
    await waitFor(() => expect(fake.versions.size).toBe(1));
    fake.addVersion((await getDocument(doc.id))!.cloudDocumentId!, '# From the other browser');
    type(container, '\n\nMine');
    await saveVersionNow();
    await screen.findByRole('dialog', { name: 'A newer version exists' });
    type(container, ' and a late edit');
    await userEvent.click(screen.getByRole('button', { name: 'Load latest' }));
    await waitFor(() => expect(editorText(container)).toBe('# From the other browser'));
    await new Promise((resolve) => setTimeout(resolve, 1200)); // longer than the autosave delay
    expect((await getDocument(doc.id))!.content).toBe('# From the other browser');
  });

  it('Save mine as a copy keeps a late edit and leaves the original on the latest version', async () => {
    fake.signIn();
    const { project, doc } = await projectWithDocument();
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`);
    await saveVersionNow();
    await waitFor(() => expect(fake.versions.size).toBe(1));
    fake.addVersion((await getDocument(doc.id))!.cloudDocumentId!, '# From the other browser');
    type(container, '\n\nMine');
    await saveVersionNow();
    await screen.findByRole('dialog', { name: 'A newer version exists' });
    type(container, ' and a late edit');
    await userEvent.click(screen.getByRole('button', { name: 'Save mine as a copy' }));
    await waitFor(() => expect(editorText(container)).toBe('# Hello\n\nWorld\n\nMine and a late edit'));
    await new Promise((resolve) => setTimeout(resolve, 1200)); // longer than the autosave delay
    expect((await getDocument(doc.id))!.content).toBe('# From the other browser');
  });

  it('test_save_with_expired_session_signs_out', async () => {
    // Review Focus 1: the session ends while the app is open.
    fake.signIn();
    const { project, doc } = await projectWithDocument();
    renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByRole('button', { name: 'Save version' });
    fake.signOut();
    await saveVersionNow();
    await waitFor(() => expect(statusText()).toContain('Your session ended. Sign in again to save versions.'));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect((await getDocument(doc.id))!.content).toBe('# Hello\n\nWorld');
  });

  it('test_sign_in_flushes_the_draft_first', async () => {
    // Review Focus 4: an edit still waiting for autosave is stored before the page leaves.
    const { project, doc } = await projectWithDocument();
    let storedWhenLeaving: string | undefined;
    const assign = vi.fn(async () => {
      storedWhenLeaving = (await getDocument(doc.id))!.content;
    });
    const { container } = renderAt(`/p/${project.id}/d/${doc.id}`, assign);
    await screen.findByRole('button', { name: 'Sign in' });
    type(container, '\n\nNot autosaved yet');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign in with GitHub' }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    await waitFor(() => expect(storedWhenLeaving).toBe('# Hello\n\nWorld\n\nNot autosaved yet'));
  });

  it('names an image the server refused and saves without it (final review I3)', async () => {
    fake.signIn();
    const { project, doc } = await projectWithDocument('![drawing](d.svg)\n');
    const svg = new TextEncoder().encode('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg xmlns="http://www.w3.org/2000/svg"/>');
    await addImage(project.id, null, { name: 'd.svg', type: 'image/svg+xml', bytes: svg.buffer as ArrayBuffer });
    renderAt(`/p/${project.id}/d/${doc.id}`);
    await saveVersionNow();
    await waitFor(() => expect(statusText()).toContain('Saved version 1 without d.svg: that image can’t be stored in the cloud.'));
    expect([...fake.versions.values()][0]!.images).toEqual([]);
  });

  it('reports an unreachable server when saving', async () => {
    fake.signIn();
    const { project, doc } = await projectWithDocument();
    renderAt(`/p/${project.id}/d/${doc.id}`);
    await screen.findByRole('button', { name: 'Save version' });
    fake.offline = true;
    await saveVersionNow();
    await waitFor(() =>
      expect(statusText()).toContain('Couldn’t save a version: md.IT can’t reach the cloud. Your work is still saved in this browser.'),
    );
  });

  describe('history', () => {
    async function twoVersions() {
      fake.signIn();
      const { project, doc } = await projectWithDocument();
      const view = renderAt(`/p/${project.id}/d/${doc.id}`);
      await saveVersionNow('First');
      await waitFor(() => expect(fake.versions.size).toBe(1));
      type(view.container, '\n\nSecond');
      await saveVersionNow();
      await waitFor(() => expect(fake.versions.size).toBe(2));
      await userEvent.click(screen.getByRole('button', { name: 'Show panel' }));
      await userEvent.click(await screen.findByRole('radio', { name: 'History' }));
      await screen.findByRole('button', { name: /^v2/ });
      return { ...view, project, doc };
    }

    it('opening a version shows it read-only; Restore puts its text in the editor and marks dirty', async () => {
      const { container, doc } = await twoVersions();
      await userEvent.click(screen.getByRole('button', { name: /^v1/ }));
      expect(await screen.findByText('Version 1 · read-only')).toBeInTheDocument();
      expect(container.querySelector('.cm-editor')).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
      await waitFor(() => expect(editorText(container)).toBe('# Hello\n\nWorld'));
      expect(statusText()).toContain('Restored version 1.');
      const stored = (await getDocument(doc.id))!;
      expect(stored.dirty).toBe(true);
      expect(stored.headVersionId).toBe([...fake.versions.values()].find((v) => v.number === 2)!.id);
    });

    it('Restore asks first when there are changes since the last version (final review I4)', async () => {
      const { container } = await twoVersions();
      type(container, '\n\nNot saved as a version'); // opening a version writes it first
      await userEvent.click(screen.getByRole('button', { name: /^v1/ }));
      await userEvent.click(await screen.findByRole('button', { name: 'Restore' }));
      expect(
        screen.getByText('Restore version 1? Your changes since the last saved version will be replaced.'),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByText('Version 1 · read-only')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
      await userEvent.click(screen.getByRole('button', { name: 'Restore version' }));
      await waitFor(() => expect(editorText(container)).toBe('# Hello\n\nWorld'));
    });

    it('Delete asks, then removes the version and refreshes the list', async () => {
      await twoVersions();
      await userEvent.click(screen.getByRole('button', { name: /^v1/ }));
      await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
      expect(screen.getByText('Delete version 1? This can’t be undone.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Delete version' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: /^v1/ })).not.toBeInTheDocument());
      expect([...fake.versions.values()].map((v) => v.number)).toEqual([2]);
      expect(screen.queryByText('Version 1 · read-only')).not.toBeInTheDocument();
    });

    it('Close returns to the editor', async () => {
      const { container } = await twoVersions();
      await userEvent.click(screen.getByRole('button', { name: /^v1/ }));
      await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
      await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
      expect(editorText(container)).toBe('# Hello\n\nWorld\n\nSecond');
    });

    it('Close keeps an edit typed while the version was opening', async () => {
      const { container, doc } = await twoVersions();
      fireEvent.click(screen.getByRole('button', { name: /^v1/ }));
      type(container, '\n\nDuring the read');
      await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
      await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull());
      expect(editorText(container)).toBe('# Hello\n\nWorld\n\nSecond\n\nDuring the read');
      expect((await getDocument(doc.id))!.content).toBe('# Hello\n\nWorld\n\nSecond\n\nDuring the read');
    });

    it('Restore aims at the version that is latest now, not when the viewer opened', async () => {
      const { container, doc } = await twoVersions();
      await userEvent.click(screen.getByRole('button', { name: /^v1/ }));
      await screen.findByText('Version 1 · read-only');
      const newer = fake.addVersion((await getDocument(doc.id))!.cloudDocumentId!, '# From the other browser');
      await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
      await waitFor(() => expect(editorText(container)).toBe('# Hello\n\nWorld'));
      expect((await getDocument(doc.id))!.headVersionId).toBe(newer.id);
    });

    it('a document saved under another account keeps its link when History opens', async () => {
      const { doc } = await twoVersions();
      const { cloudDocumentId } = (await getDocument(doc.id))!;
      fake.versions.clear();
      fake.documents.clear();
      await userEvent.click(screen.getByRole('radio', { name: 'Outline' }));
      await userEvent.click(screen.getByRole('radio', { name: 'History' }));
      expect(await screen.findByText('No versions yet')).toBeInTheDocument();
      expect((await getDocument(doc.id))!.cloudDocumentId).toBe(cloudDocumentId);
    });

    it('switching documents closes the viewer', async () => {
      const { project } = await twoVersions();
      const other = await createDocument(project.id, null, 'Other');
      await userEvent.click(screen.getByRole('button', { name: /^v1/ }));
      await screen.findByText('Version 1 · read-only');
      await userEvent.click(await screen.findByText('Other.md'));
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/p/${project.id}/d/${other.id}`));
      expect(screen.queryByText('Version 1 · read-only')).not.toBeInTheDocument();
    });
  });
});


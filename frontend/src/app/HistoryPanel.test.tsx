import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi, setApi } from '../api';
import { clearDatabase, createDocument, createProject, linkDocument, saveDocumentContent } from '../store';
import { createFakeApi, type FakeApi } from '../test/fakeApi';
import { HistoryPanel } from './HistoryPanel';

let fake: FakeApi;

beforeEach(async () => {
  await clearDatabase();
  fake = createFakeApi();
  fake.signIn();
  setApi(createApi(fake.fetch));
});

async function linkedDocument() {
  const project = await createProject('OS');
  const doc = await createDocument(project.id, null, 'Intro');
  await saveDocumentContent(doc.id, '# Hi');
  const cloudProject = { id: 'p-cloud', name: 'OS', created_at: '2026-10-01T00:00:00Z' };
  fake.projects.set(cloudProject.id, cloudProject);
  const cloudDoc = { id: 'd-cloud', project_id: cloudProject.id, path: 'Intro.md', created_at: '2026-10-01T00:00:00Z', next_number: 1 };
  fake.documents.set(cloudDoc.id, cloudDoc);
  const v1 = fake.addVersion(cloudDoc.id, '# One', { message: 'First' });
  const v2 = fake.addVersion(cloudDoc.id, '# Two');
  await linkDocument(doc.id, { cloudDocumentId: cloudDoc.id, headVersionId: v2.id });
  return { doc, v1, v2 };
}

describe('HistoryPanel', () => {
  it('signed out: asks to sign in', () => {
    render(<HistoryPanel docId="x" headVersionId={undefined} signedIn={false} refreshKey={0} onOpen={() => {}} />);
    expect(screen.getByText('Sign in to keep versions')).toBeInTheDocument();
    expect(screen.getByText('Saved versions live in your md.IT account and open on any browser.')).toBeInTheDocument();
  });

  it('a document never saved has no versions yet', async () => {
    const project = await createProject('OS');
    const doc = await createDocument(project.id, null, 'Intro');
    render(<HistoryPanel docId={doc.id} headVersionId={undefined} signedIn refreshKey={0} onOpen={() => {}} />);
    expect(await screen.findByText('No versions yet')).toBeInTheDocument();
    expect(screen.getByText('Save version keeps a copy of this document in your account.')).toBeInTheDocument();
  });

  it('lists versions newest first and marks the head current', async () => {
    const { doc, v2 } = await linkedDocument();
    render(<HistoryPanel docId={doc.id} headVersionId={v2.id} signedIn refreshKey={0} onOpen={() => {}} />);
    const items = await screen.findAllByRole('button', { name: /^v\d/ });
    expect(items.map((item) => item.textContent?.slice(0, 2))).toEqual(['v2', 'v1']);
    expect(items[0]).toHaveTextContent('Current');
    expect(items[0]).toHaveTextContent('No message');
    expect(items[1]).toHaveTextContent('First');
  });

  it('opens a version with the latest id', async () => {
    const { doc, v1, v2 } = await linkedDocument();
    const onOpen = vi.fn();
    render(<HistoryPanel docId={doc.id} headVersionId={v2.id} signedIn refreshKey={0} onOpen={onOpen} />);
    await userEvent.click((await screen.findAllByRole('button', { name: /^v1/ }))[0]!);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: v1.id, number: 1 }));
  });

  it('says when versions can’t be loaded', async () => {
    const { doc, v2 } = await linkedDocument();
    fake.offline = true;
    render(<HistoryPanel docId={doc.id} headVersionId={v2.id} signedIn refreshKey={0} onOpen={() => {}} />);
    expect(await screen.findByText('Couldn’t load versions.')).toBeInTheDocument();
  });

  it('reloads when refreshKey changes', async () => {
    const { doc, v2 } = await linkedDocument();
    const { rerender } = render(<HistoryPanel docId={doc.id} headVersionId={v2.id} signedIn refreshKey={0} onOpen={() => {}} />);
    await screen.findAllByRole('button', { name: /^v2/ });
    fake.addVersion('d-cloud', '# Three');
    rerender(<HistoryPanel docId={doc.id} headVersionId={v2.id} signedIn refreshKey={1} onOpen={() => {}} />);
    expect(await screen.findByRole('button', { name: /^v3/ })).toBeInTheDocument();
  });
});

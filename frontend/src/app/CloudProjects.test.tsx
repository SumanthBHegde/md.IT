import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi, setApi } from '../api';
import { AuthProvider } from '../auth';
import { clearDatabase, createProject, getProject, linkProject } from '../store';
import { createFakeApi, type FakeApi } from '../test/fakeApi';
import { CloudProjects } from './CloudProjects';

let fake: FakeApi;

beforeEach(async () => {
  await clearDatabase();
  fake = createFakeApi();
  fake.signIn();
  setApi(createApi(fake.fetch));
});

function mount(onDownloaded = vi.fn()) {
  render(
    <MemoryRouter>
      <AuthProvider>
        <CloudProjects onDownloaded={onDownloaded} />
      </AuthProvider>
    </MemoryRouter>,
  );
  return onDownloaded;
}

function cloud(name: string, withVersion = true) {
  const project = { id: `p-${name}`, name, created_at: '2026-10-01T09:00:00.000Z' };
  fake.projects.set(project.id, project);
  const doc = { id: `d-${name}`, project_id: project.id, path: 'a.md', created_at: project.created_at, next_number: 1 };
  fake.documents.set(doc.id, doc);
  if (withVersion) fake.addVersion(doc.id, `# ${name}`);
  return project;
}

describe('CloudProjects', () => {
  it('lists cloud projects not yet in this browser', async () => {
    cloud('Notes');
    const linked = cloud('Already here');
    const local = await createProject('Already here');
    await linkProject(local.id, linked.id);
    mount();
    expect(await screen.findByRole('heading', { name: 'In your account' })).toBeInTheDocument();
    expect(await screen.findByText('Notes')).toBeInTheDocument();
    expect(screen.getByText(/1 document · saved/)).toBeInTheDocument();
    expect(screen.queryByText('Already here')).not.toBeInTheDocument();
  });

  it('says when everything is already in this browser', async () => {
    mount();
    expect(await screen.findByText('Everything in your account is in this browser.')).toBeInTheDocument();
  });

  it('Download imports the project and reports it', async () => {
    const project = cloud('Notes');
    const onDownloaded = mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Download Notes' }));
    await waitFor(() => expect(onDownloaded).toHaveBeenCalledWith(expect.any(String), 'Downloaded 1 document.'));
    const projectId = onDownloaded.mock.calls[0]![0] as string;
    expect((await getProject(projectId))?.cloudProjectId).toBe(project.id);
  });

  it('shows the error copy when the list can’t load', async () => {
    setApi(
      createApi(async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (request.method === 'GET' && new URL(request.url).pathname === '/api/projects') return new Response(null, { status: 500 });
        return fake.fetch(request);
      }),
    );
    mount();
    expect(await screen.findByText('Couldn’t load your account’s projects.')).toBeInTheDocument();
  });

  it('is hidden when signed out', async () => {
    fake.signOut();
    const { container } = render(
      <MemoryRouter>
        <AuthProvider>
          <CloudProjects onDownloaded={() => {}} />
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(fake.calls.some((c) => c.path === '/api/me')).toBe(true));
    expect(container.querySelector('section')).toBeNull();
  });
});

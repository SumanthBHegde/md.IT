import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi, setApi } from '../api';
import { clearDatabase, setSetting, SETTINGS } from '../store';
import { createFakeApi } from '../test/fakeApi';
import { App } from './App';

beforeEach(async () => {
  await clearDatabase();
  delete document.documentElement.dataset.theme;
});

describe('App', () => {
  it('shows the project list at /', async () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
  });

  it('explains unknown paths', async () => {
    render(<MemoryRouter initialEntries={['/nowhere']}><App /></MemoryRouter>);
    expect(await screen.findByText('This page doesn’t exist')).toBeInTheDocument();
  });

  it('applies the stored theme to the document root', async () => {
    await setSetting(SETTINGS.theme, 'dark');
    render(<MemoryRouter><App /></MemoryRouter>);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    await setSetting(SETTINGS.theme, 'system');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeUndefined());
  });

  it('says why sign-in failed when the address carries login_error', async () => {
    render(<MemoryRouter initialEntries={['/?login_error=state']}><App /></MemoryRouter>);
    expect(await screen.findByText('Sign-in took too long or started in another tab. Try again.')).toBeInTheDocument();
  });

  it('downloads a cloud project on a new browser and opens it with a notice', async () => {
    const fake = createFakeApi();
    fake.signIn();
    setApi(createApi(fake.fetch));
    fake.projects.set('p-cloud', { id: 'p-cloud', name: 'Thesis', created_at: '2026-10-01T09:00:00.000Z' });
    fake.documents.set('d-cloud', { id: 'd-cloud', project_id: 'p-cloud', path: 'Chapter.md', created_at: '2026-10-01T09:00:00.000Z', next_number: 1 });
    fake.addVersion('d-cloud', '# Chapter one');
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: 'Download Thesis' }));
    expect(await screen.findByText('Downloaded 1 document.')).toBeInTheDocument();
    expect(await screen.findByText('Chapter.md')).toBeInTheDocument();
  });
});

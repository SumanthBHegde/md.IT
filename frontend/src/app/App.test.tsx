import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDatabase, setSetting, SETTINGS } from '../store';
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
});

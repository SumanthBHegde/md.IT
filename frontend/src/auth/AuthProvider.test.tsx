import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi, setApi } from '../api';
import { createFakeApi, type FakeApi } from '../test/fakeApi';
import { AuthProvider } from './AuthProvider';
import { LoginErrorNotice } from './LoginErrorNotice';
import { useAuth, type Auth } from './useAuth';

let fake: FakeApi;
let auth: Auth;

function Probe() {
  auth = useAuth();
  const location = useLocation();
  return (
    <p>
      {auth.state} {auth.user?.provider ?? '-'} [{auth.providers.join(',')}] {location.pathname + location.search}
    </p>
  );
}

function mount(path = '/p/1', assign = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider assign={assign}>
        <Probe />
        <LoginErrorNotice />
      </AuthProvider>
    </MemoryRouter>,
  );
  return assign;
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
}

beforeEach(() => {
  fake = createFakeApi();
  setApi(createApi(fake.fetch));
});
afterEach(() => {
  setApi(null);
  vi.restoreAllMocks();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('AuthProvider', () => {
  it('starts loading, then signed-in with the user and providers', async () => {
    fake.signIn('alice');
    mount();
    expect(screen.getByText(/^loading/)).toBeInTheDocument();
    expect(await screen.findByText(/^signed-in dev \[github,dev\]/)).toBeInTheDocument();
  });

  it('is signed-out on 401', async () => {
    mount();
    expect(await screen.findByText(/^signed-out/)).toBeInTheDocument();
  });

  it('is unavailable when the server can’t be reached', async () => {
    fake.offline = true;
    mount();
    expect(await screen.findByText(/^unavailable/)).toBeInTheDocument();
  });

  it('signIn navigates to the login URL with the current path', async () => {
    const assign = mount('/p/1?q=a');
    await screen.findByText(/^signed-out/);
    act(() => auth.signIn('github'));
    expect(assign).toHaveBeenCalledWith('/api/auth/login/github?next=%2Fp%2F1%3Fq%3Da');
    act(() => auth.signIn('dev', { name: 'bob' }));
    expect(assign).toHaveBeenLastCalledWith('/api/auth/login/dev?next=%2Fp%2F1%3Fq%3Da&name=bob');
  });

  it('signOut posts logout and becomes signed-out', async () => {
    fake.signIn();
    mount();
    await screen.findByText(/^signed-in/);
    await act(() => auth.signOut());
    expect(screen.getByText(/^signed-out/)).toBeInTheDocument();
    expect(fake.calls.some((c) => c.method === 'POST' && c.path === '/api/auth/logout')).toBe(true);
  });

  it('deleteAccount deletes and becomes signed-out', async () => {
    fake.signIn();
    mount();
    await screen.findByText(/^signed-in/);
    await act(() => auth.deleteAccount());
    expect(screen.getByText(/^signed-out/)).toBeInTheDocument();
    expect(fake.calls.some((c) => c.method === 'DELETE' && c.path === '/api/me')).toBe(true);
  });

  it('sessionEnded becomes signed-out', async () => {
    fake.signIn();
    mount();
    await screen.findByText(/^signed-in/);
    act(() => auth.sessionEnded());
    expect(screen.getByText(/^signed-out/)).toBeInTheDocument();
  });

  it('refreshes after the tab was hidden for more than 5 minutes', async () => {
    fake.signIn();
    mount();
    await screen.findByText(/^signed-in/);
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    setVisibility('hidden');
    fake.signOut();
    clock.mockReturnValue(start + 4 * 60_000);
    setVisibility('visible');
    expect(screen.getByText(/^signed-in/)).toBeInTheDocument(); // 4 minutes away: no re-check
    setVisibility('hidden');
    clock.mockReturnValue(start + 10 * 60_000);
    setVisibility('visible');
    await waitFor(() => expect(screen.getByText(/^signed-out/)).toBeInTheDocument());
  });

  it('LoginErrorNotice shows the message and removes login_error from the address', async () => {
    mount('/?login_error=denied&x=1');
    expect(await screen.findByText('Sign-in was cancelled.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/ \/\?x=1$/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Sign-in was cancelled.')).not.toBeInTheDocument();
  });

  it('outside a provider useAuth is signed out', () => {
    render(
      <MemoryRouter>
        <Probe />
      </MemoryRouter>,
    );
    expect(screen.getByText(/^signed-out/)).toBeInTheDocument();
  });
});

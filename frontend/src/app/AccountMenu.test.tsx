import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi, setApi } from '../api';
import { AuthProvider } from '../auth';
import { clearDatabase, createProject, getProject, linkProject } from '../store';
import { createFakeApi, type FakeApi } from '../test/fakeApi';
import { AccountMenu } from './AccountMenu';

let fake: FakeApi;

beforeEach(async () => {
  await clearDatabase();
  fake = createFakeApi();
  setApi(createApi(fake.fetch));
});

function mount(props: Parameters<typeof AccountMenu>[0] = {}, assign = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/p/1']}>
      <AuthProvider assign={assign}>
        <AccountMenu {...props} />
      </AuthProvider>
    </MemoryRouter>,
  );
  return assign;
}

describe('AccountMenu', () => {
  it('signed out: offers the server’s providers', async () => {
    fake.providers = ['github', 'google', 'dev'];
    const assign = mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('menuitem', { name: 'Sign in with GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sign in with Google' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign in with GitHub' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/api/auth/login/github?next=%2Fp%2F1'));
  });

  it('says when the server can’t be reached and tries again', async () => {
    fake.offline = true;
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('menuitem', { name: 'md.IT can’t reach the cloud' })).toBeDisabled();
    fake.offline = false;
    await userEvent.click(screen.getByRole('menuitem', { name: 'Try again' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('menuitem', { name: 'Sign in with GitHub' })).toBeInTheDocument();
  });

  it('signed out: the dev item asks for a valid name first', async () => {
    const assign = mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign in as a dev user…' }));
    const field = screen.getByLabelText('Name');
    const submit = within(screen.getByRole('dialog', { name: 'Sign in as a dev user' })).getByRole('button', { name: 'Sign in' });
    await userEvent.type(field, 'Alice');
    await userEvent.click(submit);
    expect(await screen.findByText('Use 1–64 lowercase letters, digits, _ or -.')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    await userEvent.clear(field);
    await userEvent.type(field, 'alice');
    await userEvent.click(submit);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/api/auth/login/dev?next=%2Fp%2F1&name=alice'));
  });

  it('waits for onBeforeLeave before leaving the page', async () => {
    const order: string[] = [];
    const assign = vi.fn(() => order.push('assign'));
    mount({ onBeforeLeave: async () => void order.push('flush') }, assign);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign in with GitHub' }));
    await waitFor(() => expect(order).toEqual(['flush', 'assign']));
  });

  it('signed in: names the account and signs out', async () => {
    fake.signIn('alice');
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Account: dev user' }));
    expect(screen.getByRole('menuitem', { name: 'Signed in as a dev user' })).toBeDisabled();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signed in: deletes the account after confirming and clears cloud links', async () => {
    fake.signIn('alice');
    const project = await createProject('Notes');
    await linkProject(project.id, 'cloud-p');
    const onAccountDeleted = vi.fn();
    mount({ onAccountDeleted });
    await userEvent.click(await screen.findByRole('button', { name: 'Account: dev user' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete account…' }));
    expect(
      screen.getByText('Delete your account? Every saved version and image is removed from the cloud. Projects in this browser stay.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect((await getProject(project.id))?.cloudProjectId).toBeUndefined();
    expect(onAccountDeleted).toHaveBeenCalled();
  });
});

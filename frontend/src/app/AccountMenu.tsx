import { useState } from 'react';
import type { Me } from '../api';
import { useAuth } from '../auth';
import { ConfirmDialog } from '../dialogs';
import { clearCloudLinks } from '../store';
import { MenuButton, type MenuItem } from '../ui';
import { DevSignInDialog } from './DevSignInDialog';

const PROVIDER_NAMES: Record<string, string> = { github: 'GitHub', google: 'Google', dev: 'a dev user' };

export interface AccountMenuProps {
  /** Runs before the page leaves to sign in (the workspace writes the pending edit). */
  onBeforeLeave?: () => Promise<void>;
  onAccountDeleted?: () => void;
}

/** What the account is called in the toolbar: the email, else the provider (the server shares no dev name). */
function accountName(user: Me): string {
  if (user.provider === 'dev') return 'dev user';
  return user.email ?? PROVIDER_NAMES[user.provider] ?? user.provider;
}

function signedInAs(user: Me): string {
  if (user.provider === 'dev') return 'Signed in as a dev user';
  const provider = PROVIDER_NAMES[user.provider] ?? user.provider;
  return user.email ? `Signed in with ${provider} as ${user.email}` : `Signed in with ${provider}`;
}

/** The account control at the right of the toolbars (P-077). Local work never depends on it. */
export function AccountMenu({ onBeforeLeave, onAccountDeleted }: AccountMenuProps) {
  const auth = useAuth();
  const [dialog, setDialog] = useState<'dev' | 'delete' | null>(null);

  const leaveFor = async (provider: string, name?: string) => {
    try {
      await onBeforeLeave?.();
    } finally {
      auth.signIn(provider, name === undefined ? undefined : { name });
    }
  };

  if (auth.state === 'loading') return null;

  if (auth.state !== 'signed-in' || !auth.user) {
    const items: MenuItem[] = auth.providers.map((provider) =>
      provider === 'dev'
        ? { label: 'Sign in as a dev user…', icon: 'user', onSelect: () => setDialog('dev') }
        : { label: `Sign in with ${PROVIDER_NAMES[provider] ?? provider}`, onSelect: () => void leaveFor(provider) },
    );
    return (
      <>
        <MenuButton
          text="Sign in"
          label="Sign in"
          items={
            auth.state === 'unavailable'
              ? [
                  // The page loaded while the server was down (or it went away): say so, and offer a retry.
                  { label: 'md.IT can’t reach the cloud', disabled: true },
                  { label: 'Try again', onSelect: () => void auth.refresh() },
                ]
              : items.length > 0
                ? items
                : [{ label: 'Sign-in isn’t available right now', disabled: true }]
          }
        />
        {dialog === 'dev' && <DevSignInDialog onClose={() => setDialog(null)} onSubmit={(name) => void leaveFor('dev', name)} />}
      </>
    );
  }

  const user = auth.user;
  return (
    <>
      <MenuButton
        icon="user"
        label={`Account: ${accountName(user)}`}
        items={[
          { label: signedInAs(user), disabled: true },
          'separator',
          // If the server can't be reached the cookie may live on, but this tab stops using it.
          { label: 'Sign out', onSelect: () => void auth.signOut().catch(() => auth.sessionEnded()) },
          { label: 'Delete account…', icon: 'trash', danger: true, onSelect: () => setDialog('delete') },
        ]}
      />
      {dialog === 'delete' && (
        <ConfirmDialog
          title="Delete account"
          message="Delete your account? Every saved version and image is removed from the cloud. Projects in this browser stay."
          confirmLabel="Delete account"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await auth.deleteAccount();
            await clearCloudLinks();
            onAccountDeleted?.();
          }}
        />
      )}
    </>
  );
}

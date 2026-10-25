import { useId, useState, type FormEvent } from 'react';
import { DEV_NAME } from '../auth';
import { Button, Dialog, Input } from '../ui';

/** Development-only sign-in (DEV_LOGIN, P-058): pick a dev user name, then leave for the login route. */
export function DevSignInDialog({ onSubmit, onClose }: { onSubmit: (name: string) => void; onClose: () => void }) {
  const formId = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!DEV_NAME.test(name)) {
      setError('Use 1–64 lowercase letters, digits, _ or -.');
      return;
    }
    onSubmit(name);
  };

  return (
    <Dialog
      title="Sign in as a dev user"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary">
            Sign in
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit}>
        <Input
          label="Name"
          hint="Development only. The same name always signs in as the same user."
          value={name}
          error={error}
          autoComplete="off"
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
          }}
        />
      </form>
    </Dialog>
  );
}

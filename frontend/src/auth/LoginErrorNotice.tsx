import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Callout, IconButton } from '../ui';
import { loginErrorMessage } from './loginError';

const PARAM = 'login_error';

/** Coming back from a failed sign-in (`?login_error=…`): say what happened, and tidy the address. */
export function LoginErrorNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get(PARAM);
    if (code === null) return;
    setMessage(loginErrorMessage(code));
    params.delete(PARAM);
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
  }, [location, navigate]);

  if (!message) return null;
  return (
    <div className="login-notice" role="status">
      <Callout tone="warning" actions={<IconButton icon="x" label="Dismiss" onClick={() => setMessage(null)} />}>
        {message}
      </Callout>
    </div>
  );
}

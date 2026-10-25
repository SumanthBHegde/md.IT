/** What `?login_error=` means for the person who just came back from signing in. */
const MESSAGES: Record<string, string> = {
  denied: 'Sign-in was cancelled.',
  state: 'Sign-in took too long or started in another tab. Try again.',
  provider: 'The provider couldn’t sign you in. Try again.',
};

export function loginErrorMessage(code: string): string {
  return MESSAGES[code] ?? 'Sign-in didn’t work. Try again.';
}

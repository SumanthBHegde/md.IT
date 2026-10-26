import { describe, expect, it } from 'vitest';
import { loginErrorMessage } from './loginError';

describe('loginErrorMessage', () => {
  it.each([
    ['denied', 'Sign-in was cancelled.'],
    ['state', 'Sign-in took too long or started in another tab. Try again.'],
    ['provider', 'The provider couldn’t sign you in. Try again.'],
    ['nope', 'Sign-in didn’t work. Try again.'],
  ])('%s', (code, message) => {
    expect(loginErrorMessage(code)).toBe(message);
  });
});

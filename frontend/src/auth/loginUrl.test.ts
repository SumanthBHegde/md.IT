import { describe, expect, it } from 'vitest';
import { DEV_NAME, loginUrl } from './loginUrl';

describe('loginUrl', () => {
  it('test_login_url_keeps_path_and_query', () => {
    // Review Focus 5: the user comes back to the same place, search included.
    expect(loginUrl('github', '/p/1/d/2?q=x y')).toBe('/api/auth/login/github?next=%2Fp%2F1%2Fd%2F2%3Fq%3Dx%20y');
  });

  it('adds the dev name', () => {
    expect(loginUrl('dev', '/', 'alice')).toBe('/api/auth/login/dev?next=%2F&name=alice');
  });

  it('checks dev names like the server', () => {
    expect(['alice', 'a_b-1', 'x'.repeat(64)].every((n) => DEV_NAME.test(n))).toBe(true);
    expect(['', 'Alice', 'a b', 'x'.repeat(65), 'ä'].some((n) => DEV_NAME.test(n))).toBe(false);
  });
});

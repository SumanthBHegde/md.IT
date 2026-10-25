/** Dev login names, as the server checks them (spec 5a 5.2). */
export const DEV_NAME = /^[a-z0-9_-]{1,64}$/;

/** Where the browser goes to sign in; `next` brings it back to the same path and query (P-077). */
export function loginUrl(provider: string, next: string, name?: string): string {
  const url = `/api/auth/login/${encodeURIComponent(provider)}?next=${encodeURIComponent(next)}`;
  return name === undefined ? url : `${url}&name=${encodeURIComponent(name)}`;
}

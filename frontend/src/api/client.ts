import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { paths } from './schema';

/** The typed md.IT API (P-076). Only this module imports openapi-fetch. */
export type Api = Client<paths>;

export const OFFLINE_MESSAGE = 'md.IT can’t reach the cloud.';

/** An API failure: the server's error code and message, or `offline` (status 0) when it couldn't be reached. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Every request but GET and HEAD carries the CSRF header (P-064). */
const csrf: Middleware = {
  onRequest({ request }) {
    if (request.method !== 'GET' && request.method !== 'HEAD') request.headers.set('X-MdIt-CSRF', '1');
    return request;
  },
};

export function createApi(fetchImpl?: typeof fetch): Api {
  const api = createClient<paths>({
    baseUrl: window.location.origin,
    credentials: 'same-origin',
    // Looked up per call, so a test that swaps globalThis.fetch is honoured.
    fetch: fetchImpl ?? ((input) => globalThis.fetch(input)),
  });
  api.use(csrf);
  return api;
}

function toApiError(status: number, error: unknown): ApiError {
  const body = (error as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  if (body && typeof body.code === 'string') {
    return new ApiError(status, body.code, typeof body.message === 'string' ? body.message : `HTTP ${status}`, body.details);
  }
  // A gateway answering for a backend that is down (no md.IT error body): as good as unreachable.
  if (status === 502 || status === 503 || status === 504) return new ApiError(status, 'unavailable', OFFLINE_MESSAGE);
  return new ApiError(status, `http_${status}`, `Something went wrong (HTTP ${status}).`);
}

type Result<T> = { data?: T; error?: unknown; response: Response };

/** Run one call: its data on success, an ApiError otherwise (offline when fetch itself failed). */
export async function request<T>(run: () => Promise<Result<T>>): Promise<T> {
  let result: Result<T>;
  try {
    result = await run();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'offline', OFFLINE_MESSAGE);
  }
  if (!result.response.ok) throw toApiError(result.response.status, result.error);
  return (result.response.status === 204 ? undefined : result.data) as T;
}

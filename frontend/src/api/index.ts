import { createApi, type Api } from './client';
import type { components } from './schema';

export { ensureBlob, getBlob } from './blobs';
export { ApiError, createApi, OFFLINE_MESSAGE, request, type Api } from './client';

type Schemas = components['schemas'];
export type Me = Schemas['MeOut'];
export type ProjectOut = Schemas['ProjectOut'];
export type DocumentOut = Schemas['DocumentOut'];
export type LatestOut = Schemas['LatestOut'];
export type VersionSummary = Schemas['VersionSummary'];
export type VersionDetail = Schemas['VersionDetail'];
export type ImageRef = Schemas['ImageRef'];

let current: Api | null = null;

/** The app's one client, created on first use. */
export function getApi(): Api {
  current ??= createApi();
  return current;
}

/** Tests: swap in a client over a fake fetch (null resets to the real one). */
export function setApi(api: Api | null): void {
  current = api;
}

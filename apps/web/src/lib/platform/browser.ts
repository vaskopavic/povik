import type { Platform } from './types';

/**
 * The web build. The API is on the same origin in production and behind Vite's proxy in dev;
 * VITE_API_URL points it somewhere else.
 */
export const browserPlatform: Platform = {
  kind: 'web',
  apiBaseUrl: (import.meta.env.VITE_API_URL ?? window.location.origin).replace(/\/$/, ''),
  // `include` so the session cookie also goes to an API on another origin (VITE_API_URL).
  apiFetch: (request, init) => globalThis.fetch(request, { ...init, credentials: 'include' }),
};

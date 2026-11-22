/**
 * Everything that differs between the web build and the desktop build sits behind this
 * interface (docs/PLAN.md §6.1). Transports, secrets, login and file dialogs join it as those
 * features land.
 */
export interface Platform {
  kind: 'web' | 'desktop';
  /** Origin of the povik API, without a trailing slash. Read on every call: desktop can change it. */
  readonly apiBaseUrl: string;
  /**
   * fetch for calls to the povik API. The web build sends the session cookie; the desktop build
   * will add `Authorization: Bearer` instead and leave cookies out.
   */
  apiFetch(request: Request, init?: RequestInit): Promise<Response>;
}

/// <reference path="./google.d.ts" />
import { loadScript } from './load-script';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** Refresh when less than this much lifetime is left. */
const REFRESH_MARGIN_MS = 5 * 60_000;
const TOKEN_KEY = 'fh:token';
const HINT_KEY = 'fh:loginHint';

export interface AccessToken {
  accessToken: string;
  expiresAt: number;
  scope: string;
}

/** Recorded for every token request so the Phase 0 spike can report renewal behaviour. */
export interface TokenEvent {
  at: number;
  kind: 'interactive' | 'silent';
  ok: boolean;
  ms: number;
  expiresInSec?: number;
  error?: string;
}

/** Silent renewal failed (usually a blocked popup); the user must tap to continue. */
export class ReauthRequiredError extends Error {
  constructor(cause?: string) {
    super(`Your Google session needs to be renewed${cause ? ` (${cause})` : ''}.`);
    this.name = 'ReauthRequiredError';
  }
}

export interface GoogleAuthOptions {
  clientId: string;
  /** Defaults to the narrow `drive.file` scope. */
  scopes?: string[];
}

/**
 * Browser-only OAuth via the Google Identity Services token model.
 * There is no refresh token: renewal re-runs the token flow with `prompt: ''`,
 * which succeeds without UI while the Google session and consent are still valid.
 */
export class GoogleAuth {
  readonly scopes: string[];
  readonly events: TokenEvent[] = [];
  private client: google.accounts.oauth2.TokenClient | null = null;
  private token: AccessToken | null = null;
  private inflight: Promise<AccessToken> | null = null;
  private waiter: {
    resolve: (t: AccessToken) => void;
    reject: (e: Error) => void;
  } | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly opts: GoogleAuthOptions) {
    this.scopes = opts.scopes?.length ? opts.scopes : [DRIVE_FILE_SCOPE];
    this.token = readStoredToken();
  }

  async init(): Promise<void> {
    if (this.client) return;
    await loadScript(GIS_SRC);
    this.client = google.accounts.oauth2.initTokenClient({
      client_id: this.opts.clientId,
      scope: this.scopes.join(' '),
      callback: (resp) => this.onToken(resp),
      error_callback: (err) => this.onError(err.type + (err.message ? `: ${err.message}` : '')),
    });
  }

  /** Subscribe to token / event-log changes. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get current(): AccessToken | null {
    return this.token;
  }

  hasUsableToken(): boolean {
    return !!this.token && this.token.expiresAt - Date.now() > 60_000;
  }

  /** Must be called from a user gesture (button click) so the popup is allowed. */
  signIn(): Promise<AccessToken> {
    return this.request('interactive', { prompt: '' });
  }

  /** Remember who signed in so silent renewal targets the same account. */
  setLoginHint(email: string): void {
    safeSet(localStorage, HINT_KEY, email);
  }

  /** Returns a valid access token, renewing silently when close to expiry. */
  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && this.token.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
      return this.token.accessToken;
    }
    try {
      const t = await this.request('silent', { prompt: '' });
      return t.accessToken;
    } catch (e) {
      // Still usable for a little while: don't fail the caller yet.
      if (!forceRefresh && this.hasUsableToken()) return this.token!.accessToken;
      throw new ReauthRequiredError(e instanceof Error ? e.message : String(e));
    }
  }

  signOut(): void {
    const t = this.token;
    this.token = null;
    safeRemove(sessionStorage, TOKEN_KEY);
    safeRemove(localStorage, HINT_KEY);
    if (t) google.accounts.oauth2.revoke(t.accessToken);
    this.emit();
  }

  private request(
    kind: TokenEvent['kind'],
    overrides: google.accounts.oauth2.OverridableTokenClientConfig,
  ): Promise<AccessToken> {
    if (this.inflight) return this.inflight;
    const client = this.client;
    if (!client) return Promise.reject(new Error('GoogleAuth.init() has not completed'));

    const started = Date.now();
    const hint = safeGet(localStorage, HINT_KEY);
    this.inflight = new Promise<AccessToken>((resolve, reject) => {
      this.waiter = { resolve, reject };
      client.requestAccessToken({ ...overrides, ...(hint ? { login_hint: hint } : {}) });
    })
      .then(
        (t) => {
          this.log({ at: started, kind, ok: true, ms: Date.now() - started, expiresInSec: Math.round((t.expiresAt - Date.now()) / 1000) });
          return t;
        },
        (e: Error) => {
          this.log({ at: started, kind, ok: false, ms: Date.now() - started, error: e.message });
          throw e;
        },
      )
      .finally(() => {
        this.inflight = null;
        this.waiter = null;
      });
    return this.inflight;
  }

  private onToken(resp: google.accounts.oauth2.TokenResponse): void {
    if (resp.error) return this.onError(resp.error_description ?? resp.error);
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, ...this.scopes)) {
      return this.onError('Drive access was not granted. Please allow access when asked.');
    }
    this.token = {
      accessToken: resp.access_token,
      expiresAt: Date.now() + resp.expires_in * 1000,
      scope: resp.scope,
    };
    safeSet(sessionStorage, TOKEN_KEY, JSON.stringify(this.token));
    this.waiter?.resolve(this.token);
    this.emit();
  }

  private onError(message: string): void {
    this.waiter?.reject(new Error(message));
  }

  private log(e: TokenEvent): void {
    this.events.push(e);
    if (this.events.length > 200) this.events.shift();
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

function readStoredToken(): AccessToken | null {
  const raw = safeGet(sessionStorage, TOKEN_KEY);
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as AccessToken;
    return t.expiresAt > Date.now() + 60_000 ? t : null;
  } catch {
    return null;
  }
}

function safeGet(s: Storage, k: string): string | null {
  try {
    return s.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(s: Storage, k: string, v: string): void {
  try {
    s.setItem(k, v);
  } catch {
    /* storage unavailable: token stays in memory only */
  }
}
function safeRemove(s: Storage, k: string): void {
  try {
    s.removeItem(k);
  } catch {
    /* ignore */
  }
}

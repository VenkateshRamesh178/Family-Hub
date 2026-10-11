import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The session cookie is missing or expired. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Thin JSON client for the Family Hub API. Auth is an HttpOnly session cookie,
 * so the API must be same-origin (the Vite dev server proxies /api).
 */
export class ApiClient {
  private readonly fetchFn: FetchFn;

  constructor(
    private readonly baseUrl = '/api',
    fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? ((input, init) => fetch(input, init));
  }

  /** Every response is checked against `schema`, so API/UI drift fails loudly here. */
  async request<S extends z.ZodType>(method: string, path: string, body: unknown, schema: S): Promise<z.output<S>>;
  async request(method: string, path: string, body?: unknown): Promise<void>;
  async request(method: string, path: string, body?: unknown, schema?: z.ZodType): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(this.baseUrl + path, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, "Can't reach the Family Hub server. Check your connection and try again.");
    }
    if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
    if (res.status === 204 || !schema) return undefined;
    return schema.parse(await res.json());
  }

  get<S extends z.ZodType>(path: string, schema: S) {
    return this.request('GET', path, undefined, schema);
  }

  /**
   * PUTs a file's bytes to an upload URL from the API: an API path (local storage, sent with
   * the session cookie) or a presigned S3 URL (no cookies; the signature is the credential).
   */
  async putFile(url: string, file: Blob, headers: Record<string, string>): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'PUT',
        credentials: url.startsWith('/') ? 'same-origin' : 'omit',
        headers,
        body: file,
      });
    } catch {
      throw new ApiError(0, "Couldn't upload the file. Check your connection and try again.");
    }
    if (!res.ok) {
      const detail = url.startsWith('/') ? await errorMessage(res) : `storage answered ${res.status}`;
      throw new ApiError(res.status, `Uploading the file failed (${detail}). Please try again.`);
    }
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json();
    const detail = (data as { detail?: unknown } | null)?.detail;
    if (typeof detail === 'string' && detail) return detail;
  } catch {
    /* not JSON */
  }
  if (res.status >= 500) return 'Something went wrong on the server. Please try again.';
  return res.statusText || `Request failed (${res.status})`;
}

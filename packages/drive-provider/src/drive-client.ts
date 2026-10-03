const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

const FILE_FIELDS =
  'id,name,mimeType,parents,appProperties,modifiedTime,createdTime,trashed,writersCanShare,owners(emailAddress),capabilities(canEdit,canShare,canAddChildren)';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  modifiedTime?: string;
  createdTime?: string;
  trashed?: boolean;
  writersCanShare?: boolean;
  owners?: { emailAddress: string }[];
  capabilities?: { canEdit?: boolean; canShare?: boolean; canAddChildren?: boolean };
}

export type PermissionRole = 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';

export interface DrivePermission {
  id: string;
  type: 'user' | 'group' | 'domain' | 'anyone';
  role: PermissionRole;
  emailAddress?: string;
  displayName?: string;
  /** Only populated by Drive for some items; see share-plan.ts. */
  permissionDetails?: { inherited: boolean; role: PermissionRole }[];
}

export interface DriveChange {
  fileId: string;
  time: string;
  removed: boolean;
  file?: DriveFile & { lastModifyingUser?: { emailAddress?: string; displayName?: string } };
}

export interface DriveUser {
  displayName: string;
  emailAddress: string;
  photoLink?: string;
}

export class DriveApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(`Drive API ${status} ${reason}: ${message}`);
    this.name = 'DriveApiError';
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isForbidden(): boolean {
    return this.status === 403 && !RATE_LIMIT_REASONS.has(this.reason);
  }
}

const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

type TokenGetter = (forceRefresh?: boolean) => Promise<string>;

interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  raw?: boolean;
}

/** Thin, typed wrapper over Drive v3 REST with token refresh and backoff. */
export class DriveClient {
  /** Number of HTTP requests sent; the spike uses it to estimate quota usage. */
  requestCount = 0;

  constructor(
    private readonly getToken: TokenGetter,
    private readonly maxRetries = 4,
  ) {}

  // --- generic -------------------------------------------------------------

  async request<T>(url: string, opts: RequestOptions = {}): Promise<T> {
    const u = new URL(url);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) u.searchParams.set(k, String(v));
    }
    let forceRefresh = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken(forceRefresh);
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...opts.headers };
      let body = opts.body;
      if (opts.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.json);
      }
      this.requestCount++;
      const res = await fetch(u, { method: opts.method ?? 'GET', headers, body });
      if (res.ok) {
        if (opts.raw) return res as unknown as T;
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
      }

      const err = await toError(res);
      const retriable =
        res.status === 429 || res.status >= 500 || (res.status === 403 && RATE_LIMIT_REASONS.has(err.reason));
      if (res.status === 401 && !forceRefresh) {
        forceRefresh = true;
        continue;
      }
      if (!retriable || attempt >= this.maxRetries) throw err;
      await sleep(2 ** attempt * 500 + Math.random() * 250);
    }
  }

  // --- identity ------------------------------------------------------------

  async about(): Promise<DriveUser> {
    const r = await this.request<{ user: DriveUser }>(`${API}/about`, {
      query: { fields: 'user(displayName,emailAddress,photoLink)' },
    });
    return r.user;
  }

  // --- files ---------------------------------------------------------------

  getFile(id: string, fields = FILE_FIELDS): Promise<DriveFile> {
    return this.request(`${API}/files/${id}`, { query: { fields } });
  }

  async list(q: string, fields = FILE_FIELDS, pageSize = 100): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const r = await this.request<{ files: DriveFile[]; nextPageToken?: string }>(`${API}/files`, {
        query: { q, pageSize, pageToken, fields: `nextPageToken,files(${fields})`, spaces: 'drive' },
      });
      out.push(...r.files);
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  listChildren(folderId: string, extraQ?: string): Promise<DriveFile[]> {
    const q = `'${esc(folderId)}' in parents and trashed = false${extraQ ? ` and ${extraQ}` : ''}`;
    return this.list(q);
  }

  createFolder(name: string, parentId: string | undefined, appProperties?: Record<string, string>): Promise<DriveFile> {
    return this.request(`${API}/files`, {
      method: 'POST',
      query: { fields: FILE_FIELDS },
      json: { name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined, appProperties },
    });
  }

  createJson(name: string, parentId: string, data: unknown, appProperties?: Record<string, string>): Promise<DriveFile> {
    const boundary = `fh${crypto.randomUUID().replace(/-/g, '')}`;
    const meta = { name, mimeType: 'application/json', parents: [parentId], appProperties };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n` +
      `--${boundary}--`;
    return this.request(`${UPLOAD}/files`, {
      method: 'POST',
      query: { uploadType: 'multipart', fields: FILE_FIELDS },
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  updateJson(id: string, data: unknown): Promise<DriveFile> {
    return this.request(`${UPLOAD}/files/${id}`, {
      method: 'PATCH',
      query: { uploadType: 'media', fields: FILE_FIELDS },
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  readJson<T = unknown>(id: string): Promise<T> {
    return this.request<T>(`${API}/files/${id}`, { query: { alt: 'media' } });
  }

  updateMetadata(id: string, patch: Partial<Pick<DriveFile, 'name' | 'appProperties' | 'writersCanShare'>>): Promise<DriveFile> {
    return this.request(`${API}/files/${id}`, { method: 'PATCH', query: { fields: FILE_FIELDS }, json: patch });
  }

  deleteFile(id: string): Promise<void> {
    return this.request(`${API}/files/${id}`, { method: 'DELETE' });
  }

  // --- permissions ---------------------------------------------------------

  async listPermissions(fileId: string): Promise<DrivePermission[]> {
    const r = await this.request<{ permissions: DrivePermission[] }>(`${API}/files/${fileId}/permissions`, {
      query: { fields: 'permissions(id,type,role,emailAddress,displayName,permissionDetails(inherited,role))' },
    });
    return r.permissions;
  }

  createPermission(
    fileId: string,
    p: { emailAddress: string; role: 'reader' | 'writer' },
    notify?: { emailMessage: string },
  ): Promise<DrivePermission> {
    return this.request(`${API}/files/${fileId}/permissions`, {
      method: 'POST',
      query: {
        sendNotificationEmail: !!notify,
        emailMessage: notify?.emailMessage,
        fields: 'id,type,role,emailAddress',
      },
      json: { type: 'user', role: p.role, emailAddress: p.emailAddress },
    });
  }

  updatePermission(fileId: string, permissionId: string, role: 'reader' | 'writer'): Promise<DrivePermission> {
    return this.request(`${API}/files/${fileId}/permissions/${permissionId}`, {
      method: 'PATCH',
      query: { fields: 'id,type,role,emailAddress' },
      json: { role },
    });
  }

  deletePermission(fileId: string, permissionId: string): Promise<void> {
    return this.request(`${API}/files/${fileId}/permissions/${permissionId}`, { method: 'DELETE' });
  }

  // --- changes -------------------------------------------------------------

  async getStartPageToken(): Promise<string> {
    const r = await this.request<{ startPageToken: string }>(`${API}/changes/startPageToken`);
    return r.startPageToken;
  }

  async listChanges(pageToken: string): Promise<{ changes: DriveChange[]; nextPageToken: string }> {
    const changes: DriveChange[] = [];
    let token = pageToken;
    for (;;) {
      const r = await this.request<{ changes: DriveChange[]; nextPageToken?: string; newStartPageToken?: string }>(
        `${API}/changes`,
        {
          query: {
            pageToken: token,
            pageSize: 100,
            spaces: 'drive',
            fields: `nextPageToken,newStartPageToken,changes(fileId,time,removed,file(${FILE_FIELDS},lastModifyingUser(emailAddress,displayName)))`,
          },
        },
      );
      changes.push(...r.changes);
      if (r.newStartPageToken) return { changes, nextPageToken: r.newStartPageToken };
      token = r.nextPageToken!;
    }
  }
}

/** Escape a value for use inside a single-quoted Drive query string. */
export function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function appPropQuery(key: string, value: string): string {
  return `appProperties has { key='${esc(key)}' and value='${esc(value)}' }`;
}

async function toError(res: Response): Promise<DriveApiError> {
  let reason = 'unknown';
  let message = res.statusText;
  try {
    const j = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
    message = j.error?.message ?? message;
    reason = j.error?.errors?.[0]?.reason ?? reason;
  } catch {
    /* non-JSON error body */
  }
  return new DriveApiError(res.status, reason, message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

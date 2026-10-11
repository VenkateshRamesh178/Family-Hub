import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError, type FetchFn } from './api-client';
import { ApiProvider } from './api-provider';

interface Call {
  url: string;
  init?: RequestInit;
}

function fakeFetch(respond: (call: Call) => Response): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return respond(call);
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const item = {
  id: 'a1',
  name: 'Milk',
  quantity: 2,
  unit: 'L',
  checked: false,
  createdBy: 'ana@example.com',
  createdAt: '2026-10-03T10:00:00Z',
  updatedAt: '2026-10-03T10:00:00Z',
};

describe('ApiProvider', () => {
  it('sends JSON and parses the response', async () => {
    const f = fakeFetch(() => json(item, 201));
    const p = new ApiProvider(new ApiClient('/api', f.fetch));
    await expect(p.shopping.create({ name: 'Milk', quantity: 2, unit: 'L' })).resolves.toEqual(item);
    expect(f.calls[0]!.url).toBe('/api/shopping');
    expect(f.calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(f.calls[0]!.init?.body as string)).toEqual({ name: 'Milk', quantity: 2, unit: 'L' });
  });

  it('handles 204 and encodes path segments', async () => {
    const f = fakeFetch(() => new Response(null, { status: 204 }));
    const p = new ApiProvider(new ApiClient('/api', f.fetch));
    await expect(p.removeMember('a+b@example.com')).resolves.toBeUndefined();
    expect(f.calls[0]!.url).toBe('/api/members/a%2Bb%40example.com');
  });

  it("returns null when the user isn't in a family", async () => {
    const p = new ApiProvider(new ApiClient('/api', fakeFetch(() => json(null)).fetch));
    await expect(p.findFamily()).resolves.toBeNull();
  });

  it('turns the API detail into an ApiError', async () => {
    const p = new ApiProvider(new ApiClient('/api', fakeFetch(() => json({ detail: 'Please sign in.' }, 401)).fetch));
    const err = await p.getIdentity().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Please sign in.');
    expect((err as ApiError).isUnauthorized).toBe(true);
  });

  it('gives a friendly message for server errors without a detail', async () => {
    const p = new ApiProvider(new ApiClient('/api', fakeFetch(() => new Response('boom', { status: 500 })).fetch));
    await expect(p.todos.list()).rejects.toThrow('Something went wrong on the server');
  });

  it('reports network failures', async () => {
    const p = new ApiProvider(
      new ApiClient('/api', () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(p.purchases.list()).rejects.toMatchObject({ status: 0 });
  });

  it('rejects responses that do not match the schema', async () => {
    const p = new ApiProvider(new ApiClient('/api', fakeFetch(() => json([{ ...item, checked: 'yes' }])).fetch));
    await expect(p.shopping.list()).rejects.toThrow();
  });

  it('asks for a calendar range and parses occurrences', async () => {
    const occ = {
      key: 'event:e1:2026-10-11',
      date: '2026-10-11',
      time: '09:30:00',
      title: 'Ana',
      kind: 'birthday',
      sourceType: 'event',
      sourceId: 'e1',
      notes: '',
      recurrence: 'yearly',
      age: 36,
      done: null,
    };
    const f = fakeFetch(() => json([occ]));
    const p = new ApiProvider(new ApiClient('/api', f.fetch));
    await expect(p.calendar('2026-10-01', '2026-10-31')).resolves.toEqual([occ]);
    expect(f.calls[0]!.url).toBe('/api/calendar?from=2026-10-01&to=2026-10-31');
  });
});

describe('ApiProvider documents', () => {
  const file = new File(['%PDF-1.4'], 'Receipt.pdf', { type: 'application/pdf' });
  const doc = {
    id: 'd1',
    createdBy: 'ana@example.com',
    createdAt: '2026-10-11T10:00:00Z',
    updatedAt: '2026-10-11T10:00:00Z',
    title: 'Receipt',
    notes: '',
    folderId: null,
    expiryDate: null,
    purchaseId: 'p1',
    deletedAt: null,
    file: {
      id: 'v1',
      filename: 'Receipt.pdf',
      contentType: 'application/pdf',
      size: 8,
      uploadedAt: '2026-10-11T10:00:00Z',
      uploadedBy: 'ana@example.com',
    },
  };
  const ticket = (url: string) => ({
    uploadId: 'v1',
    url,
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    expiresAt: '2026-10-11T10:05:00Z',
  });

  function uploadFlow(putUrl: string, putStatus = 200) {
    return fakeFetch(({ url, init }) => {
      if (url === '/api/docs/uploads') return json(ticket(putUrl), 201);
      if (init?.method === 'PUT') return new Response(null, { status: putStatus });
      return json(doc, 201);
    });
  }

  it('uploads straight to S3, without cookies, then creates the document', async () => {
    const s3 = 'https://bucket.s3.ap-southeast-2.amazonaws.com/families/f/docs/v1?X-Amz-Signature=x';
    const f = uploadFlow(s3);
    const p = new ApiProvider(new ApiClient('/api', f.fetch));
    await expect(p.docs.upload(file, { purchaseId: 'p1' })).resolves.toEqual(doc);

    expect(JSON.parse(f.calls[0]!.init?.body as string)).toEqual({ filename: 'Receipt.pdf', contentType: 'application/pdf', size: 8 });
    expect(f.calls[1]!.url).toBe(s3);
    expect(f.calls[1]!.init).toMatchObject({ method: 'PUT', credentials: 'omit', headers: { 'Content-Type': 'application/pdf' } });
    expect(f.calls[1]!.init?.body).toBe(file);
    expect(f.calls[2]!.url).toBe('/api/docs');
    expect(JSON.parse(f.calls[2]!.init?.body as string)).toEqual({ uploadId: 'v1', purchaseId: 'p1' });
  });

  it('sends the session cookie when the API stores files itself', async () => {
    const f = uploadFlow('/api/docs/uploads/v1/content');
    const p = new ApiProvider(new ApiClient('/api', f.fetch));
    await p.docs.replaceFile('d1', file);
    expect(f.calls[1]!.init?.credentials).toBe('same-origin');
    expect(f.calls[2]!.url).toBe('/api/docs/d1/versions');
  });

  it('stops when the storage refuses the file', async () => {
    const f = uploadFlow('https://bucket.example/x', 403);
    const p = new ApiProvider(new ApiClient('/api', f.fetch));
    await expect(p.docs.upload(file)).rejects.toThrow('Uploading the file failed (storage answered 403)');
    expect(f.calls).toHaveLength(2);
  });

  it('rejects empty files before asking the server', async () => {
    const f = uploadFlow('/x');
    const p = new ApiProvider(new ApiClient('/api', f.fetch));
    await expect(p.docs.upload(new File([], 'empty.txt'))).rejects.toThrow('"empty.txt" is empty.');
    expect(f.calls).toHaveLength(0);
  });

  it('builds list and download queries', async () => {
    const f = fakeFetch(({ url }) => (url.includes('/download') ? json({ url: 'https://signed' }) : json([])));
    const p = new ApiProvider(new ApiClient('/api', f.fetch));
    await p.docs.list({ trash: true });
    await p.docs.list({ purchaseId: 'p 1' });
    await expect(p.docs.downloadUrl('d1', { versionId: 'v0', inline: true })).resolves.toBe('https://signed');
    expect(f.calls.map((c) => c.url)).toEqual([
      '/api/docs?trash=true',
      '/api/docs?purchaseId=p+1',
      '/api/docs/d1/download?versionId=v0&inline=true',
    ]);
  });
});

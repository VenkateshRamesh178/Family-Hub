import {
  calendarEventSchema,
  calendarOccurrenceSchema,
  docAuditEventSchema,
  docFileSchema,
  docFolderSchema,
  familyDocumentSchema,
  familySessionSchema,
  identitySchema,
  memberSchema,
  pendingInviteSchema,
  purchasedItemSchema,
  roleDefinitionSchema,
  shoppingItemSchema,
  todoSchema,
  uploadTicketSchema,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarOccurrence,
  type Collection,
  type DataProvider,
  type DocumentsApi,
  type FamilySession,
  type Identity,
  type InviteInput,
  type JoinHandle,
  type Member,
  type PendingInvite,
  type PurchasedItem,
  type PurchasedItemInput,
  type RoleDefinition,
  type ShoppingItem,
  type ShoppingItemInput,
  type Todo,
  type TodoInput,
} from '@family-hub/core';
import { z } from 'zod';
import { ApiClient } from './api-client';

const feedStatusSchema = z.object({ active: z.boolean(), createdAt: z.string().nullable().optional() });
const feedCreatedSchema = z.object({ path: z.string().startsWith('/'), createdAt: z.string() });
const downloadSchema = z.object({ url: z.string().min(1) });

export interface SignUpInput {
  displayName: string;
  email: string;
  password: string;
}

/** Paid-edition DataProvider: shared data lives in the Family Hub API (Postgres). */
export class ApiProvider implements DataProvider {
  readonly edition = 'paid' as const;

  readonly shopping: DataProvider['shopping'];
  readonly todos: Collection<Todo, TodoInput>;
  readonly purchases: Collection<PurchasedItem, PurchasedItemInput>;
  readonly events: Collection<CalendarEvent, CalendarEventInput>;
  readonly docs: DocumentsApi;

  constructor(private readonly api: ApiClient = new ApiClient()) {
    this.shopping = {
      ...collection<ShoppingItem, ShoppingItemInput>(api, '/shopping', shoppingItemSchema),
      clearChecked: () => api.request('DELETE', '/shopping/checked'),
    };
    this.todos = collection(api, '/todos', todoSchema);
    this.purchases = collection(api, '/purchases', purchasedItemSchema);
    this.events = collection(api, '/events', calendarEventSchema);
    this.docs = documents(api);
  }

  // --- Auth (paid edition only) ----------------------------------------------

  signUp(input: SignUpInput): Promise<Identity> {
    return this.api.request('POST', '/auth/signup', input, identitySchema);
  }

  signIn(email: string, password: string): Promise<Identity> {
    return this.api.request('POST', '/auth/signin', { email, password }, identitySchema);
  }

  signOut(): Promise<void> {
    return this.api.request('POST', '/auth/signout');
  }

  getIdentity(): Promise<Identity> {
    return this.api.get('/auth/me', identitySchema);
  }

  // --- Family lifecycle --------------------------------------------------------

  findFamily(): Promise<FamilySession | null> {
    return this.api.get('/family', familySessionSchema.nullable());
  }

  createFamily(name: string): Promise<FamilySession> {
    return this.api.request('POST', '/family', { name }, familySessionSchema);
  }

  joinFamily(handle: JoinHandle): Promise<FamilySession> {
    if (handle.kind !== 'invite-code') throw new Error('Join with an invite code.');
    return this.api.request('POST', '/family/join', { code: handle.code }, familySessionSchema);
  }

  listPendingInvites(): Promise<PendingInvite[]> {
    return this.api.get('/invites/mine', z.array(pendingInviteSchema));
  }

  /** Membership lives on the server, so there's nothing to forget locally. */
  async leaveOnThisDevice(): Promise<void> {}

  // --- Members -------------------------------------------------------------------

  listMembers(): Promise<Member[]> {
    return this.api.get('/members', z.array(memberSchema));
  }

  inviteMember(input: InviteInput): Promise<Member> {
    return this.api.request('POST', '/members', input, memberSchema);
  }

  changeMemberRole(email: string, roleId: string): Promise<Member> {
    return this.api.request('PATCH', `/members/${encodeURIComponent(email)}`, { roleId }, memberSchema);
  }

  removeMember(email: string): Promise<void> {
    return this.api.request('DELETE', `/members/${encodeURIComponent(email)}`);
  }

  // --- Roles -----------------------------------------------------------------------

  listRoles(): Promise<RoleDefinition[]> {
    return this.api.get('/roles', z.array(roleDefinitionSchema));
  }

  saveCustomRole(role: RoleDefinition): Promise<RoleDefinition> {
    const { builtIn: _builtIn, ...body } = role;
    return this.api.request('PUT', `/roles/${encodeURIComponent(role.id)}`, body, roleDefinitionSchema);
  }

  deleteCustomRole(roleId: string): Promise<void> {
    return this.api.request('DELETE', `/roles/${encodeURIComponent(roleId)}`);
  }

  // --- Calendar ------------------------------------------------------------------

  calendar(from: string, to: string): Promise<CalendarOccurrence[]> {
    const q = new URLSearchParams({ from, to });
    return this.api.get(`/calendar?${q}`, z.array(calendarOccurrenceSchema));
  }

  /** Whether the signed-in user has a calendar subscription link (paid edition only). */
  calendarFeedStatus(): Promise<{ active: boolean; createdAt?: string | null }> {
    return this.api.get('/calendar/feed', feedStatusSchema);
  }

  /**
   * Create the user's private .ics link, replacing any earlier one. The returned
   * path is only shown now; the server keeps just a hash.
   */
  createCalendarFeed(): Promise<{ path: string; createdAt: string }> {
    return this.api.request('POST', '/calendar/feed', undefined, feedCreatedSchema);
  }

  revokeCalendarFeed(): Promise<void> {
    return this.api.request('DELETE', '/calendar/feed');
  }
}

function documents(api: ApiClient): DocumentsApi {
  const doc = (id: string) => `/docs/${encodeURIComponent(id)}`;

  /** Gets an upload ticket, sends the bytes, and returns the upload id to attach. */
  const send = async (file: File): Promise<string> => {
    if (file.size === 0) throw new Error(`"${file.name}" is empty.`);
    const ticket = await api.request(
      'POST',
      '/docs/uploads',
      { filename: file.name, contentType: file.type, size: file.size },
      uploadTicketSchema,
    );
    await api.putFile(ticket.url, file, ticket.headers);
    return ticket.uploadId;
  };

  return {
    listFolders: () => api.get('/docs/folders', z.array(docFolderSchema)),
    createFolder: (input) => api.request('POST', '/docs/folders', input, docFolderSchema),
    updateFolder: (id, patch) => api.request('PATCH', `/docs/folders/${encodeURIComponent(id)}`, patch, docFolderSchema),
    deleteFolder: (id) => api.request('DELETE', `/docs/folders/${encodeURIComponent(id)}`),

    list: ({ trash = false, purchaseId } = {}) => {
      const q = new URLSearchParams();
      if (trash) q.set('trash', 'true');
      if (purchaseId) q.set('purchaseId', purchaseId);
      return api.get(`/docs${q.size ? `?${q}` : ''}`, z.array(familyDocumentSchema));
    },
    upload: async (file, input = {}) =>
      api.request('POST', '/docs', { uploadId: await send(file), ...input }, familyDocumentSchema),
    update: (id, patch) => api.request('PATCH', doc(id), patch, familyDocumentSchema),
    replaceFile: async (id, file) =>
      api.request('POST', `${doc(id)}/versions`, { uploadId: await send(file) }, familyDocumentSchema),
    versions: (id) => api.get(`${doc(id)}/versions`, z.array(docFileSchema)),
    restoreVersion: (id, versionId) =>
      api.request('POST', `${doc(id)}/versions/${encodeURIComponent(versionId)}/restore`, undefined, familyDocumentSchema),
    trash: (id) => api.request('DELETE', doc(id)),
    restore: (id) => api.request('POST', `${doc(id)}/restore`, undefined, familyDocumentSchema),
    purge: (id) => api.request('DELETE', `${doc(id)}?permanent=true`),
    downloadUrl: async (id, { versionId, inline = false } = {}) => {
      const q = new URLSearchParams();
      if (versionId) q.set('versionId', versionId);
      if (inline) q.set('inline', 'true');
      const res = await api.get(`${doc(id)}/download${q.size ? `?${q}` : ''}`, downloadSchema);
      return res.url;
    },
    audit: (documentId) =>
      api.get(`/docs/audit${documentId ? `?documentId=${encodeURIComponent(documentId)}` : ''}`, z.array(docAuditEventSchema)),
  };
}

function collection<T, In>(api: ApiClient, path: string, schema: z.ZodType<T>): Collection<T, In> {
  return {
    list: () => api.get(path, z.array(schema)),
    create: (input) => api.request('POST', path, input, schema),
    update: (id, patch) => api.request('PATCH', `${path}/${encodeURIComponent(id)}`, patch, schema),
    remove: (id) => api.request('DELETE', `${path}/${encodeURIComponent(id)}`),
  };
}

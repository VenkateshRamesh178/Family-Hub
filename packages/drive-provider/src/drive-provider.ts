import {
  ADMIN_ROLE,
  ADMIN_ROLE_ID,
  BUILT_IN_ROLES,
  FOLDER_KEYS,
  FOLDER_NAMES,
  NotAMemberError,
  READER_ROLE,
  RoleInUseError,
  SCHEMA_VERSION,
  assignableRoles,
  familyConfigSchema,
  inviteInputSchema,
  memberDirectorySchema,
  resolveRole,
  roleDefinitionSchema,
  rolesFileSchema,
  type DataProvider,
  type DocumentsApi,
  type FamilyConfig,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarOccurrence,
  type Collection,
  type FamilySession,
  type FolderKey,
  type Identity,
  type InviteInput,
  type JoinHandle,
  type Member,
  type PendingInvite,
  type MemberDirectory,
  type RoleDefinition,
  type PurchasedItem,
  type PurchasedItemInput,
  type RolesFile,
  type ShoppingItem,
  type ShoppingItemInput,
  type Todo,
  type TodoInput,
} from '@family-hub/core';
import { DriveApiError, DriveClient, appPropQuery } from './drive-client';
import {
  KIND_JOINED,
  KIND_ROOT,
  META_FILE_NAMES,
  PROP_FAMILY,
  PROP_FAMILY_FILE,
  PROP_KIND,
  ROOT_FOLDER_NAME,
} from './layout';
import {
  desiredGrants,
  directGrantFor,
  planShareOps,
  type CurrentGrants,
  type ShareOp,
  type ShareTarget,
} from './share-plan';

export interface DriveProviderOptions {
  client: DriveClient;
  /** Public URL of the app, included in invitation emails. */
  appUrl: string;
  storage?: Storage;
}

export class NotAFamilyFolderError extends Error {
  constructor() {
    super('That folder is not a Family Hub folder. Pick the "FamilyHub" folder the admin shared with you.');
    this.name = 'NotAFamilyFolderError';
  }
}

/** The Drive edition's session also carries the family's folder and file ids. */
export type DriveSession = FamilySession & { family: FamilyConfig };

/** Lists come to the free edition after the web (API) edition is built. */
/** Every method rejects: documents need the Drive storage layer, which isn't built yet. */
function docsNotYetBuilt(): DocumentsApi {
  const fail = () => Promise.reject(new Error("Documents aren't available in the free edition yet."));
  return new Proxy({} as DocumentsApi, { get: () => fail });
}

function notYetBuilt<T, In>(what: string): Collection<T, In> {
  const fail = () => Promise.reject(new Error(`${what} isn't available in the free edition yet.`));
  return { list: fail, create: fail, update: fail, remove: fail };
}

/** Free-edition DataProvider: all shared state lives in the admin's Google Drive. */
export class DriveProvider implements DataProvider {
  readonly edition = 'free' as const;
  readonly client: DriveClient;
  private readonly appUrl: string;
  private readonly storage: Storage | undefined;
  private identity: Identity | null = null;
  private session: DriveSession | null = null;
  private customRoles: RoleDefinition[] = [];

  readonly shopping = {
    ...notYetBuilt<ShoppingItem, ShoppingItemInput>('The shopping list'),
    clearChecked: () => Promise.reject(new Error("The shopping list isn't available in the free edition yet.")),
  };
  readonly todos = notYetBuilt<Todo, TodoInput>('To-dos');
  readonly purchases = notYetBuilt<PurchasedItem, PurchasedItemInput>('Items purchased');
  readonly events = notYetBuilt<CalendarEvent, CalendarEventInput>('The calendar');
  readonly docs = docsNotYetBuilt();

  calendar(_from: string, _to: string): Promise<CalendarOccurrence[]> {
    return Promise.reject(new Error("The calendar isn't available in the free edition yet."));
  }

  constructor(opts: DriveProviderOptions) {
    this.client = opts.client;
    this.appUrl = opts.appUrl;
    this.storage = opts.storage;
  }

  get currentSession(): DriveSession | null {
    return this.session;
  }

  async getIdentity(): Promise<Identity> {
    if (!this.identity) {
      const u = await this.client.about();
      this.identity = {
        email: u.emailAddress.toLowerCase(),
        displayName: u.displayName,
        photoUrl: u.photoLink,
      };
    }
    return this.identity;
  }

  // --- Family lifecycle ----------------------------------------------------

  async findFamily(): Promise<DriveSession | null> {
    const me = await this.getIdentity();
    const cached = this.storageGet(this.rootKey(me.email));
    if (cached) {
      try {
        return await this.openFamily(cached);
      } catch (e) {
        if (e instanceof NotAMemberError) throw e;
        if (!(e instanceof DriveApiError && (e.isNotFound || e.isForbidden)) && !(e instanceof NotAFamilyFolderError)) {
          throw e;
        }
        this.storageRemove(this.rootKey(me.email));
      }
    }

    // Any family root this app can see: one the user created, or one they
    // already picked (drive.file grants are per user, so they follow the user
    // to new devices).
    const roots = await this.client.list(`${appPropQuery(PROP_KIND, KIND_ROOT)} and trashed = false`);
    roots.sort((a, b) => Number(isOwnedBy(b, me.email)) - Number(isOwnedBy(a, me.email)));
    for (const root of roots) {
      try {
        return await this.openFamily(root.id);
      } catch (e) {
        if (e instanceof NotAMemberError) throw e;
        // Unreadable or half-created folder: try the next one.
      }
    }
    return null;
  }

  async createFamily(name: string): Promise<DriveSession> {
    const me = await this.getIdentity();
    const familyId = crypto.randomUUID();
    const tag = (kind: string) => ({ [PROP_KIND]: kind, [PROP_FAMILY]: familyId });

    const root = await this.client.createFolder(ROOT_FOLDER_NAME, undefined, tag(KIND_ROOT));
    const folders = {} as Record<FolderKey, string>;
    for (const key of FOLDER_KEYS) {
      folders[key] = (await this.client.createFolder(FOLDER_NAMES[key], root.id, tag(key))).id;
    }

    const now = new Date().toISOString();
    const directory: MemberDirectory = { schemaVersion: SCHEMA_VERSION, updatedAt: now, members: [] };
    const roles: RolesFile = { schemaVersion: SCHEMA_VERSION, roles: [] };
    const membersFile = await this.client.createJson(META_FILE_NAMES.members, folders.meta, directory, tag('members'));
    const rolesFile = await this.client.createJson(META_FILE_NAMES.roles, folders.meta, roles, tag('roles'));

    const config: FamilyConfig = familyConfigSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      familyId,
      name: name.trim(),
      ownerEmail: me.email,
      createdAt: now,
      rootFolderId: root.id,
      folders,
      metaFiles: { members: membersFile.id, roles: rolesFile.id },
    });
    const familyFile = await this.client.createJson(META_FILE_NAMES.family, folders.meta, config, tag('family'));

    // Point the root at family.json, and stop Editors from re-sharing.
    await this.client.updateMetadata(root.id, {
      appProperties: { [PROP_FAMILY_FILE]: familyFile.id },
      writersCanShare: false,
    });
    for (const id of Object.values(folders)) {
      await this.client.updateMetadata(id, { writersCanShare: false });
    }

    return this.openFamily(root.id);
  }

  async joinFamily(handle: JoinHandle): Promise<DriveSession> {
    if (handle.kind !== 'drive-folder') throw new Error('The free edition joins via a shared Drive folder.');
    return this.openFamily(handle.folderId);
  }

  /** Drive emails the invite itself; members join by picking the shared folder. */
  async listPendingInvites(): Promise<PendingInvite[]> {
    return [];
  }

  async leaveOnThisDevice(): Promise<void> {
    const me = await this.getIdentity();
    this.storageRemove(this.rootKey(me.email));
    this.session = null;
    this.customRoles = [];
  }

  // --- Members -------------------------------------------------------------

  async listMembers(): Promise<Member[]> {
    const s = this.requireSession();
    const dir = await this.readDirectory();
    if (!s.isAdmin) return dir.members;

    // Best effort: mark members who have opened the app (they leave a marker in audit/).
    let joined = new Set<string>();
    try {
      const markers = await this.client.listChildren(s.family.folders.audit, appPropQuery(PROP_KIND, KIND_JOINED));
      joined = new Set(markers.map((m) => m.appProperties?.email ?? '').filter(Boolean));
    } catch {
      /* not visible under drive.file — see the spike */
    }
    return dir.members.map((m) => (joined.has(m.email) ? { ...m, status: 'active' as const } : m));
  }

  async inviteMember(input: InviteInput): Promise<Member> {
    const s = this.requireAdmin();
    const { email, roleId } = inviteInputSchema.parse(input);
    if (email === s.family.ownerEmail) throw new Error('You are already the admin of this family.');
    const role = this.assignableRole(roleId);

    const dir = await this.readDirectory();
    if (dir.members.some((m) => m.email === email)) throw new Error(`${email} is already a member.`);

    await this.applyShares(email, role);

    const member: Member = {
      email,
      roleId: role.id,
      status: 'invited',
      invitedAt: new Date().toISOString(),
      invitedBy: s.me.email,
    };
    await this.writeDirectory({ ...dir, members: [...dir.members, member] });
    return member;
  }

  async changeMemberRole(email: string, roleId: string): Promise<Member> {
    this.requireAdmin();
    const role = this.assignableRole(roleId);
    const dir = await this.readDirectory();
    const existing = dir.members.find((m) => m.email === email);
    if (!existing) throw new Error(`${email} is not a member.`);

    await this.applyShares(email, role);
    const updated = { ...existing, roleId: role.id };
    await this.writeDirectory({ ...dir, members: dir.members.map((m) => (m.email === email ? updated : m)) });
    return updated;
  }

  async removeMember(email: string): Promise<void> {
    this.requireAdmin();
    await this.applyShares(email, null);
    const dir = await this.readDirectory();
    await this.writeDirectory({ ...dir, members: dir.members.filter((m) => m.email !== email) });
  }

  // --- Roles ---------------------------------------------------------------

  async listRoles(): Promise<RoleDefinition[]> {
    this.requireSession();
    this.customRoles = (await this.readRoles()).roles;
    return assignableRoles(this.customRoles);
  }

  async saveCustomRole(role: RoleDefinition): Promise<RoleDefinition> {
    this.requireAdmin();
    const parsed = roleDefinitionSchema.parse({ ...role, builtIn: false });
    if (BUILT_IN_ROLES.some((r) => r.id === parsed.id)) throw new Error('Built-in roles cannot be changed.');

    const file = await this.readRoles();
    const existed = file.roles.some((r) => r.id === parsed.id);
    const roles = existed ? file.roles.map((r) => (r.id === parsed.id ? parsed : r)) : [...file.roles, parsed];
    await this.client.updateJson(this.requireSession().family.metaFiles.roles, { ...file, roles });
    this.customRoles = roles;

    // Re-share for everyone who already holds this role.
    if (existed) {
      const dir = await this.readDirectory();
      for (const m of dir.members.filter((x) => x.roleId === parsed.id)) await this.applyShares(m.email, parsed);
    }
    return parsed;
  }

  async deleteCustomRole(roleId: string): Promise<void> {
    this.requireAdmin();
    const dir = await this.readDirectory();
    const holders = dir.members.filter((m) => m.roleId === roleId).length;
    if (holders) throw new RoleInUseError(roleId, holders);
    const file = await this.readRoles();
    const roles = file.roles.filter((r) => r.id !== roleId);
    await this.client.updateJson(this.requireSession().family.metaFiles.roles, { ...file, roles });
    this.customRoles = roles;
  }

  // --- internals -----------------------------------------------------------

  private async openFamily(rootId: string): Promise<DriveSession> {
    const me = await this.getIdentity();
    const root = await this.client.getFile(rootId);
    const familyFileId = root.appProperties?.[PROP_FAMILY_FILE];
    if (root.appProperties?.[PROP_KIND] !== KIND_ROOT || !familyFileId) throw new NotAFamilyFolderError();

    const family = familyConfigSchema.parse(await this.client.readJson(familyFileId));
    // Set early so readDirectory/readRoles can use it.
    this.session = { family, me, role: ADMIN_ROLE, isAdmin: false };

    const isAdmin = family.ownerEmail === me.email;
    this.customRoles = (await this.readRoles()).roles;
    let role: RoleDefinition = ADMIN_ROLE;
    if (!isAdmin) {
      const member = (await this.readDirectory()).members.find((m) => m.email === me.email);
      if (!member) {
        this.session = null;
        throw new NotAMemberError(me.email);
      }
      role = resolveRole(member.roleId, this.customRoles) ?? READER_ROLE;
      void this.markJoined(family, me);
    }

    this.session = { family, me, role, isAdmin };
    this.storageSet(this.rootKey(me.email), rootId);
    return this.session;
  }

  /** Leave a one-time marker so the admin can see this member has signed in. */
  private async markJoined(family: FamilyConfig, me: Identity): Promise<void> {
    const key = `fh:joined:${family.familyId}:${me.email}`;
    if (this.storageGet(key)) return;
    try {
      await this.client.createJson(
        `joined-${me.email}.json`,
        family.folders.audit,
        { email: me.email, at: new Date().toISOString() },
        { [PROP_KIND]: KIND_JOINED, [PROP_FAMILY]: family.familyId, email: me.email },
      );
      this.storageSet(key, '1');
    } catch {
      /* role without audit write access, or drive.file limits */
    }
  }

  private async applyShares(email: string, role: RoleDefinition | null): Promise<ShareOp[]> {
    const s = this.requireAdmin();
    const ids: Record<ShareTarget, string> = { root: s.family.rootFolderId, ...s.family.folders };
    const targets = Object.keys(ids) as ShareTarget[];

    const current: CurrentGrants = {};
    await Promise.all(
      targets.map(async (t) => {
        const grant = directGrantFor(t, await this.client.listPermissions(ids[t]), email);
        if (grant) current[t] = grant;
      }),
    );

    const ops = planShareOps(desiredGrants(role), current);
    for (const op of ops) {
      const fileId = ids[op.target];
      if (op.op === 'create') {
        const notify = op.target === 'root' ? { emailMessage: this.inviteMessage(s) } : undefined;
        await this.client.createPermission(fileId, { emailAddress: email, role: op.role }, notify);
      } else if (op.op === 'update') {
        await this.client.updatePermission(fileId, op.permissionId, op.role);
      } else {
        await this.client.deletePermission(fileId, op.permissionId);
      }
    }
    return ops;
  }

  private inviteMessage(s: DriveSession): string {
    return (
      `${s.me.displayName} invited you to the "${s.family.name}" Family Hub.\n\n` +
      `Open ${this.appUrl} on your phone, sign in with this Google account, ` +
      `tap "Join a family" and choose the shared "${ROOT_FOLDER_NAME}" folder.`
    );
  }

  private assignableRole(roleId: string): RoleDefinition {
    if (roleId === ADMIN_ROLE_ID) throw new Error('There is only one admin: the owner of the Drive folder.');
    const role = resolveRole(roleId, this.customRoles);
    if (!role) throw new Error(`Unknown role "${roleId}".`);
    return role;
  }

  private async readDirectory(): Promise<MemberDirectory> {
    const s = this.requireSession();
    return memberDirectorySchema.parse(await this.client.readJson(s.family.metaFiles.members));
  }

  private async writeDirectory(dir: MemberDirectory): Promise<void> {
    const s = this.requireAdmin();
    await this.client.updateJson(s.family.metaFiles.members, { ...dir, updatedAt: new Date().toISOString() });
  }

  private async readRoles(): Promise<RolesFile> {
    const s = this.requireSession();
    return rolesFileSchema.parse(await this.client.readJson(s.family.metaFiles.roles));
  }

  private requireSession(): DriveSession {
    if (!this.session) throw new Error('No family is open.');
    return this.session;
  }

  private requireAdmin(): DriveSession {
    const s = this.requireSession();
    if (!s.isAdmin) throw new Error('Only the family admin can do this.');
    return s;
  }

  private rootKey(email: string): string {
    return `fh:root:${email}`;
  }
  private storageGet(k: string): string | null {
    try {
      return this.storage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  }
  private storageSet(k: string, v: string): void {
    try {
      this.storage?.setItem(k, v);
    } catch {
      /* ignore */
    }
  }
  private storageRemove(k: string): void {
    try {
      this.storage?.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

function isOwnedBy(f: { owners?: { emailAddress: string }[] }, email: string): boolean {
  return !!f.owners?.some((o) => o.emailAddress.toLowerCase() === email);
}

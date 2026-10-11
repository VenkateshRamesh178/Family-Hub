/**
 * Roles and permissions shared by both editions.
 *
 * Free edition: a role is a set of per-folder Drive share levels. Permissions
 * are enforced by Drive itself; `can()` only drives what the UI shows.
 * Paid edition: the same role ids map to rows in `role_permissions` and are
 * enforced server-side.
 */

/** Top-level folders inside the family's shared root. */
export const FOLDER_KEYS = ['meta', 'lists', 'docs', 'chat', 'audit', 'snapshots'] as const;
export type FolderKey = (typeof FOLDER_KEYS)[number];

/**
 * The vault is deliberately absent: vault access is always a separate,
 * explicit grant and never derived from a role (plan §5). It arrives in Phase 4.
 */
export const FOLDER_NAMES: Record<FolderKey, string> = {
  meta: '_meta',
  lists: 'lists',
  docs: 'docs',
  chat: 'chat',
  audit: 'audit',
  snapshots: 'snapshots',
};

/**
 * Every member gets at least `reader` on everything, because the family root is
 * shared as Viewer and Drive permissions inherit downward. A role can only
 * elevate individual folders to `writer`.
 */
export type FolderAccess = 'reader' | 'writer';

export interface RoleDefinition {
  id: string;
  name: string;
  builtIn: boolean;
  description?: string;
  folders: Record<FolderKey, FolderAccess>;
}

export const ADMIN_ROLE_ID = 'admin';
export const EDITOR_ROLE_ID = 'editor';
export const READER_ROLE_ID = 'reader';

/** Admin = owner of the Drive tree. Never shared as a role; there is one admin. */
export const ADMIN_ROLE: RoleDefinition = {
  id: ADMIN_ROLE_ID,
  name: 'Admin',
  builtIn: true,
  description: 'Owns the family Drive folder. Full access.',
  folders: {
    meta: 'writer',
    lists: 'writer',
    docs: 'writer',
    chat: 'writer',
    audit: 'writer',
    snapshots: 'writer',
  },
};

export const EDITOR_ROLE: RoleDefinition = {
  id: EDITOR_ROLE_ID,
  name: 'Editor',
  builtIn: true,
  description: 'Can read and change shared data.',
  folders: {
    meta: 'reader',
    lists: 'writer',
    docs: 'writer',
    chat: 'writer',
    audit: 'writer',
    snapshots: 'writer',
  },
};

export const READER_ROLE: RoleDefinition = {
  id: READER_ROLE_ID,
  name: 'Reader',
  builtIn: true,
  description: 'Read-only, but can chat.',
  folders: {
    meta: 'reader',
    lists: 'reader',
    docs: 'reader',
    // Chat is writable by every role (plan §10 default assumption).
    chat: 'writer',
    // Readers append their own view events to the best-effort audit trail.
    audit: 'writer',
    snapshots: 'reader',
  },
};

export const BUILT_IN_ROLES: readonly RoleDefinition[] = [ADMIN_ROLE, EDITOR_ROLE, READER_ROLE];

/** Roles that can be assigned to an invited member (everything except admin). */
export function assignableRoles(customRoles: readonly RoleDefinition[]): RoleDefinition[] {
  return [EDITOR_ROLE, READER_ROLE, ...customRoles];
}

export function resolveRole(
  roleId: string,
  customRoles: readonly RoleDefinition[],
): RoleDefinition | undefined {
  return BUILT_IN_ROLES.find((r) => r.id === roleId) ?? customRoles.find((r) => r.id === roleId);
}

export type Resource = 'family' | 'members' | 'roles' | 'lists' | 'calendar' | 'docs' | 'chat';
export type Action = 'read' | 'write';

const RESOURCE_FOLDER: Partial<Record<Resource, FolderKey>> = {
  lists: 'lists',
  // The calendar is family planning data, like the lists, so it shares their permission.
  calendar: 'lists',
  docs: 'docs',
  chat: 'chat',
};

/** UI-level permission check. Real enforcement is Drive sharing (free) or the API (paid). */
export function can(role: RoleDefinition, resource: Resource, action: Action): boolean {
  if (role.id === ADMIN_ROLE_ID) return true;
  if (action === 'read') return true;
  const folder = RESOURCE_FOLDER[resource];
  // family / members / roles live in _meta, which only the admin may write.
  if (!folder) return false;
  return role.folders[folder] === 'writer';
}

export function slugifyRoleId(name: string): string {
  return (
    'custom-' +
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

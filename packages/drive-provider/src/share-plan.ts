import { ADMIN_ROLE_ID, FOLDER_KEYS, type FolderAccess, type FolderKey, type RoleDefinition } from '@family-hub/core';
import type { DrivePermission } from './drive-client';

/**
 * Role → Drive share mapping (plan §5), as pure functions so it can be tested.
 *
 * Every member gets Viewer on the family root, which Drive inherits down to every
 * folder. A role then adds a direct Editor permission on each folder it may write.
 * Removing someone means deleting those direct permissions; the inherited Viewer
 * entries disappear with the root permission.
 */
export type ShareTarget = 'root' | FolderKey;

export interface DirectGrant {
  permissionId: string;
  role: FolderAccess;
}

export type CurrentGrants = Partial<Record<ShareTarget, DirectGrant>>;
export type DesiredGrants = Partial<Record<ShareTarget, FolderAccess>>;

export type ShareOp =
  | { op: 'create'; target: ShareTarget; role: FolderAccess }
  | { op: 'update'; target: ShareTarget; permissionId: string; role: FolderAccess }
  | { op: 'delete'; target: ShareTarget; permissionId: string };

const TARGETS: readonly ShareTarget[] = ['root', ...FOLDER_KEYS];

export function desiredGrants(role: RoleDefinition | null): DesiredGrants {
  if (!role) return {};
  if (role.id === ADMIN_ROLE_ID) throw new Error('The admin role is the Drive owner and is never shared.');
  const out: DesiredGrants = { root: 'reader' };
  for (const k of FOLDER_KEYS) if (role.folders[k] === 'writer') out[k] = 'writer';
  return out;
}

/**
 * Operations that turn `current` into `desired`. The root grant is created first
 * (it carries the invitation email) and deleted last.
 */
export function planShareOps(desired: DesiredGrants, current: CurrentGrants): ShareOp[] {
  const ops: ShareOp[] = [];
  for (const target of TARGETS) {
    const want = desired[target];
    const have = current[target];
    if (want && !have) ops.push({ op: 'create', target, role: want });
    else if (want && have && have.role !== want) ops.push({ op: 'update', target, permissionId: have.permissionId, role: want });
    else if (!want && have) ops.push({ op: 'delete', target, permissionId: have.permissionId });
  }
  const rank = (o: ShareOp) => (o.target === 'root' ? (o.op === 'delete' ? 1 : -1) : 0);
  return ops.sort((a, b) => rank(a) - rank(b));
}

/**
 * Find the member's *direct* grant on one folder from its permission list.
 *
 * Drive only reports `permissionDetails.inherited` for some items. When it is
 * missing we rely on our own invariant: on subfolders we only ever create
 * `writer` grants, and the root is only ever shared as `reader`, so a `reader`
 * entry on a subfolder must be the inherited root grant.
 */
export function directGrantFor(
  target: ShareTarget,
  permissions: readonly DrivePermission[],
  email: string,
): DirectGrant | undefined {
  const p = permissions.find((x) => x.type === 'user' && x.emailAddress?.toLowerCase() === email.toLowerCase());
  if (!p || p.role === 'owner') return undefined;
  const role: FolderAccess = p.role === 'reader' || p.role === 'commenter' ? 'reader' : 'writer';

  if (p.permissionDetails?.length) {
    const direct = p.permissionDetails.filter((d) => !d.inherited);
    if (!direct.length) return undefined;
    const directRole = direct.some((d) => d.role !== 'reader' && d.role !== 'commenter') ? 'writer' : 'reader';
    return { permissionId: p.id, role: directRole };
  }

  if (target !== 'root' && role === 'reader') return undefined;
  return { permissionId: p.id, role };
}

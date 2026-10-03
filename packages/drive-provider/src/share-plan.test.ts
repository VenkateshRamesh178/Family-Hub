import { ADMIN_ROLE, EDITOR_ROLE, READER_ROLE, type RoleDefinition } from '@family-hub/core';
import { describe, expect, it } from 'vitest';
import type { DrivePermission } from './drive-client';
import { desiredGrants, directGrantFor, planShareOps } from './share-plan';

const shopper: RoleDefinition = {
  id: 'custom-shopper',
  name: 'Shopper',
  builtIn: false,
  folders: { ...READER_ROLE.folders, lists: 'writer' },
};

describe('desiredGrants', () => {
  it('editor: viewer on root + editor on every writable folder', () => {
    expect(desiredGrants(EDITOR_ROLE)).toEqual({
      root: 'reader',
      lists: 'writer',
      docs: 'writer',
      chat: 'writer',
      audit: 'writer',
      snapshots: 'writer',
    });
  });

  it('reader: viewer on root, writer only on chat and audit', () => {
    expect(desiredGrants(READER_ROLE)).toEqual({ root: 'reader', chat: 'writer', audit: 'writer' });
  });

  it('no role means no grants', () => {
    expect(desiredGrants(null)).toEqual({});
  });

  it('refuses to share the admin role', () => {
    expect(() => desiredGrants(ADMIN_ROLE)).toThrow();
  });
});

describe('planShareOps', () => {
  it('fresh invite creates root first', () => {
    const ops = planShareOps(desiredGrants(READER_ROLE), {});
    expect(ops[0]).toEqual({ op: 'create', target: 'root', role: 'reader' });
    expect(ops.map((o) => o.target).sort()).toEqual(['audit', 'chat', 'root']);
  });

  it('editor → reader removes write grants and keeps the root', () => {
    const current = {
      root: { permissionId: 'p', role: 'reader' as const },
      lists: { permissionId: 'p', role: 'writer' as const },
      docs: { permissionId: 'p', role: 'writer' as const },
      chat: { permissionId: 'p', role: 'writer' as const },
      audit: { permissionId: 'p', role: 'writer' as const },
      snapshots: { permissionId: 'p', role: 'writer' as const },
    };
    expect(planShareOps(desiredGrants(READER_ROLE), current)).toEqual([
      { op: 'delete', target: 'lists', permissionId: 'p' },
      { op: 'delete', target: 'docs', permissionId: 'p' },
      { op: 'delete', target: 'snapshots', permissionId: 'p' },
    ]);
  });

  it('reader → shopper adds lists only', () => {
    const current = {
      root: { permissionId: 'p', role: 'reader' as const },
      chat: { permissionId: 'p', role: 'writer' as const },
      audit: { permissionId: 'p', role: 'writer' as const },
    };
    expect(planShareOps(desiredGrants(shopper), current)).toEqual([{ op: 'create', target: 'lists', role: 'writer' }]);
  });

  it('removal deletes root last', () => {
    const current = {
      root: { permissionId: 'p', role: 'reader' as const },
      chat: { permissionId: 'p', role: 'writer' as const },
    };
    const ops = planShareOps({}, current);
    expect(ops.at(-1)).toEqual({ op: 'delete', target: 'root', permissionId: 'p' });
  });

  it('fixes a root that was manually elevated to editor', () => {
    expect(planShareOps({ root: 'reader' }, { root: { permissionId: 'p', role: 'writer' } })).toEqual([
      { op: 'update', target: 'root', permissionId: 'p', role: 'reader' },
    ]);
  });
});

describe('directGrantFor', () => {
  const perm = (role: DrivePermission['role'], extra: Partial<DrivePermission> = {}): DrivePermission => ({
    id: 'p1',
    type: 'user',
    role,
    emailAddress: 'Kid@Example.com',
    ...extra,
  });

  it('matches email case-insensitively', () => {
    expect(directGrantFor('root', [perm('reader')], 'kid@example.com')).toEqual({ permissionId: 'p1', role: 'reader' });
  });

  it('treats a reader entry on a subfolder as inherited', () => {
    expect(directGrantFor('lists', [perm('reader')], 'kid@example.com')).toBeUndefined();
  });

  it('treats a writer entry on a subfolder as direct', () => {
    expect(directGrantFor('lists', [perm('writer')], 'kid@example.com')).toEqual({ permissionId: 'p1', role: 'writer' });
  });

  it('uses permissionDetails when Drive provides them', () => {
    const inherited = perm('writer', { permissionDetails: [{ inherited: true, role: 'writer' }] });
    expect(directGrantFor('lists', [inherited], 'kid@example.com')).toBeUndefined();
  });

  it('never reports the owner', () => {
    expect(directGrantFor('root', [perm('owner')], 'kid@example.com')).toBeUndefined();
  });
});

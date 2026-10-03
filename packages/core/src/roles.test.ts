import { describe, expect, it } from 'vitest';
import {
  ADMIN_ROLE,
  EDITOR_ROLE,
  READER_ROLE,
  assignableRoles,
  can,
  resolveRole,
  slugifyRoleId,
  type RoleDefinition,
} from './roles';
import { roleDefinitionSchema } from './schemas';

const listsOnly: RoleDefinition = {
  id: 'custom-shopper',
  name: 'Shopper',
  builtIn: false,
  folders: { ...READER_ROLE.folders, lists: 'writer' },
};

describe('can', () => {
  it('admin can do everything', () => {
    expect(can(ADMIN_ROLE, 'members', 'write')).toBe(true);
    expect(can(ADMIN_ROLE, 'docs', 'write')).toBe(true);
  });

  it('editor writes data but not family metadata', () => {
    expect(can(EDITOR_ROLE, 'lists', 'write')).toBe(true);
    expect(can(EDITOR_ROLE, 'docs', 'write')).toBe(true);
    expect(can(EDITOR_ROLE, 'members', 'write')).toBe(false);
    expect(can(EDITOR_ROLE, 'roles', 'write')).toBe(false);
  });

  it('reader is read-only except chat', () => {
    expect(can(READER_ROLE, 'lists', 'read')).toBe(true);
    expect(can(READER_ROLE, 'lists', 'write')).toBe(false);
    expect(can(READER_ROLE, 'docs', 'write')).toBe(false);
    expect(can(READER_ROLE, 'chat', 'write')).toBe(true);
  });

  it('custom roles follow their folder grants', () => {
    expect(can(listsOnly, 'lists', 'write')).toBe(true);
    expect(can(listsOnly, 'docs', 'write')).toBe(false);
  });
});

describe('role helpers', () => {
  it('never offers admin as an assignable role', () => {
    expect(assignableRoles([listsOnly]).map((r) => r.id)).toEqual([
      'editor',
      'reader',
      'custom-shopper',
    ]);
  });

  it('resolves built-in and custom roles', () => {
    expect(resolveRole('editor', [])).toBe(EDITOR_ROLE);
    expect(resolveRole('custom-shopper', [listsOnly])).toBe(listsOnly);
    expect(resolveRole('nope', [listsOnly])).toBeUndefined();
  });

  it('slugifies custom role names', () => {
    expect(slugifyRoleId('  Grand Parents! ')).toBe('custom-grand-parents');
  });

  it('built-in roles satisfy the schema', () => {
    for (const r of [ADMIN_ROLE, EDITOR_ROLE, READER_ROLE, listsOnly]) {
      expect(roleDefinitionSchema.parse(r)).toEqual(r);
    }
  });
});

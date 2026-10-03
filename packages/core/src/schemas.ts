import { z } from 'zod';
import { FOLDER_KEYS, type FolderKey } from './roles';

export const SCHEMA_VERSION = 1;

const folderAccess = z.enum(['reader', 'writer']);

export const roleDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  builtIn: z.boolean(),
  description: z.string().optional(),
  folders: z.object(
    Object.fromEntries(FOLDER_KEYS.map((k) => [k, folderAccess])) as Record<
      FolderKey,
      typeof folderAccess
    >,
  ),
});

export const memberStatusSchema = z.enum(['invited', 'active']);
export type MemberStatus = z.infer<typeof memberStatusSchema>;

export const memberSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  roleId: z.string().min(1),
  status: memberStatusSchema,
  invitedAt: z.string(),
  invitedBy: z.string(),
});
export type Member = z.infer<typeof memberSchema>;

/** `_meta/members.json` — written only by the admin. Signed in Phase 4. */
export const memberDirectorySchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  updatedAt: z.string(),
  members: z.array(memberSchema),
});
export type MemberDirectory = z.infer<typeof memberDirectorySchema>;

/** `_meta/roles.json` — custom roles only; built-ins live in code. */
export const rolesFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  roles: z.array(roleDefinitionSchema),
});
export type RolesFile = z.infer<typeof rolesFileSchema>;

/** `_meta/family.json` */
export const familyConfigSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  familyId: z.string().min(1),
  name: z.string().min(1).max(60),
  ownerEmail: z.string().email(),
  createdAt: z.string(),
  rootFolderId: z.string().min(1),
  folders: z.object(
    Object.fromEntries(FOLDER_KEYS.map((k) => [k, z.string().min(1)])) as Record<
      FolderKey,
      z.ZodString
    >,
  ),
  /** File ids inside `_meta/`, so members never need to search for them. */
  metaFiles: z.object({
    members: z.string().min(1),
    roles: z.string().min(1),
  }),
});
export type FamilyConfig = z.infer<typeof familyConfigSchema>;

export const inviteInputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  roleId: z.string().min(1),
});
export type InviteInput = z.infer<typeof inviteInputSchema>;

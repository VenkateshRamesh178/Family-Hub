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

/** What every edition knows about a family. */
export const familySchema = z.object({
  familyId: z.string().min(1),
  name: z.string().min(1).max(60),
  ownerEmail: z.string().email(),
  createdAt: z.string(),
});
export type Family = z.infer<typeof familySchema>;

/** `_meta/family.json` (free edition): the family plus where its Drive folders are. */
export const familyConfigSchema = familySchema.extend({
  schemaVersion: z.literal(SCHEMA_VERSION),
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

export const identitySchema = z.object({
  email: z.string().email(),
  displayName: z.string(),
  photoUrl: z.string().optional(),
});

export const familySessionSchema = z.object({
  family: familySchema,
  me: identitySchema,
  role: roleDefinitionSchema,
  isAdmin: z.boolean(),
});

/** An invitation waiting for the signed-in user (paid edition). */
export const pendingInviteSchema = z.object({
  code: z.string().min(1),
  familyName: z.string(),
  invitedBy: z.string(),
  roleName: z.string(),
});
export type PendingInvite = z.infer<typeof pendingInviteSchema>;

import type { RoleDefinition } from './roles';
import type { FamilyConfig, InviteInput, Member } from './schemas';

export interface Identity {
  email: string;
  displayName: string;
  photoUrl?: string;
}

/** What the signed-in user can see of the family they belong to. */
export interface FamilySession {
  family: FamilyConfig;
  me: Identity;
  role: RoleDefinition;
  isAdmin: boolean;
}

/** How a member points the app at an existing family. */
export type JoinHandle =
  /** Free edition: the shared root folder id the member selected in the Google Picker. */
  | { kind: 'drive-folder'; folderId: string }
  /** Paid edition: an invite code. */
  | { kind: 'invite-code'; code: string };

/**
 * The single seam between the UI and storage. `DriveProvider` (free edition) and
 * `ApiProvider` (paid edition) both implement it; the React app only talks to this.
 *
 * Phase 2+ modules (lists, purchased items, documents, vault, chat) will be added
 * here as separate sub-interfaces when they are built.
 */
export interface DataProvider {
  readonly edition: 'free' | 'paid';

  getIdentity(): Promise<Identity>;

  // --- Family lifecycle ---------------------------------------------------
  /** Find a family this user owns or has already joined on this device. */
  findFamily(): Promise<FamilySession | null>;
  createFamily(name: string): Promise<FamilySession>;
  joinFamily(handle: JoinHandle): Promise<FamilySession>;
  /** Forget the family on this device (does not delete any data). */
  leaveOnThisDevice(): Promise<void>;

  // --- Admin: members -----------------------------------------------------
  listMembers(): Promise<Member[]>;
  inviteMember(input: InviteInput): Promise<Member>;
  changeMemberRole(email: string, roleId: string): Promise<Member>;
  removeMember(email: string): Promise<void>;

  // --- Admin: roles -------------------------------------------------------
  /** Built-in assignable roles plus custom roles. */
  listRoles(): Promise<RoleDefinition[]>;
  saveCustomRole(role: RoleDefinition): Promise<RoleDefinition>;
  deleteCustomRole(roleId: string): Promise<void>;
}

export class NotAMemberError extends Error {
  constructor(email: string) {
    super(`${email} is not a member of this family. Ask the admin to invite you.`);
    this.name = 'NotAMemberError';
  }
}

export class RoleInUseError extends Error {
  constructor(roleId: string, count: number) {
    super(`Role "${roleId}" is still assigned to ${count} member(s).`);
    this.name = 'RoleInUseError';
  }
}

import type { CalendarEvent, CalendarEventInput, CalendarOccurrence } from './calendar';
import type { DocAuditEvent, DocFile, DocFolder, DocFolderInput, DocumentInput, FamilyDocument } from './docs';
import type {
  PurchasedItem,
  PurchasedItemInput,
  ShoppingItem,
  ShoppingItemInput,
  Todo,
  TodoInput,
} from './lists';
import type { RoleDefinition } from './roles';
import type { Family, InviteInput, Member, PendingInvite } from './schemas';

export interface Identity {
  email: string;
  displayName: string;
  photoUrl?: string;
}

/** What the signed-in user can see of the family they belong to. */
export interface FamilySession {
  family: Family;
  me: Identity;
  role: RoleDefinition;
  isAdmin: boolean;
}

/** How a member points the app at an existing family. */
export type JoinHandle =
  /** Free edition: the shared root folder id the member selected in the Google Picker. */
  | { kind: 'drive-folder'; folderId: string }
  /** Paid edition: the code of a pending invite (see `listPendingInvites`). */
  | { kind: 'invite-code'; code: string };

/** CRUD for one family-shared list. Updates are partial and last-write-wins. */
export interface Collection<T, In> {
  list(): Promise<T[]>;
  create(input: In): Promise<T>;
  update(id: string, patch: Partial<In>): Promise<T>;
  remove(id: string): Promise<void>;
}

/** Shared documents. Everything except reading needs the `docs` writer permission. */
export interface DocumentsApi {
  listFolders(): Promise<DocFolder[]>;
  createFolder(input: DocFolderInput): Promise<DocFolder>;
  updateFolder(id: string, patch: Partial<DocFolderInput>): Promise<DocFolder>;
  /** Only empty folders can be deleted. */
  deleteFolder(id: string): Promise<void>;

  /** Documents not in the trash, or with `trash: true` only those in it. */
  list(options?: { trash?: boolean; purchaseId?: string }): Promise<FamilyDocument[]>;
  /** Uploads `file` and creates a document for it. The title defaults to the file name. */
  upload(file: File, input?: Partial<DocumentInput>): Promise<FamilyDocument>;
  update(id: string, patch: Partial<DocumentInput>): Promise<FamilyDocument>;
  /** Uploads a new version of the file. Earlier versions are kept. */
  replaceFile(id: string, file: File): Promise<FamilyDocument>;
  /** Every version of the file, newest first. */
  versions(id: string): Promise<DocFile[]>;
  restoreVersion(id: string, versionId: string): Promise<FamilyDocument>;
  trash(id: string): Promise<void>;
  restore(id: string): Promise<FamilyDocument>;
  /** Deletes the document and every version of its file, for good. */
  purge(id: string): Promise<void>;
  /** A short-lived link to the file. `inline` opens PDFs, images and text in the browser. */
  downloadUrl(id: string, options?: { versionId?: string; inline?: boolean }): Promise<string>;
  /** Newest first: for one document, or the whole family. */
  audit(documentId?: string): Promise<DocAuditEvent[]>;
}

/**
 * The single seam between the UI and storage. `DriveProvider` (free edition) and
 * `ApiProvider` (paid edition) both implement it; the React app only talks to this.
 *
 * Later modules (vault, chat) will be added here as they are built.
 */
export interface DataProvider {
  readonly edition: 'free' | 'paid';

  getIdentity(): Promise<Identity>;

  // --- Family lifecycle ---------------------------------------------------
  /** Find a family this user owns or has already joined on this device. */
  findFamily(): Promise<FamilySession | null>;
  createFamily(name: string): Promise<FamilySession>;
  joinFamily(handle: JoinHandle): Promise<FamilySession>;
  /** Invitations waiting for the signed-in user. Always empty in the free edition (Drive emails them). */
  listPendingInvites(): Promise<PendingInvite[]>;
  /** Forget the family on this device (does not delete any data). */
  leaveOnThisDevice(): Promise<void>;

  // --- Members -----------------------------------------------------------
  /** Family members (the paid edition includes the admin). Readable by all; the rest of this section is admin-only. */
  listMembers(): Promise<Member[]>;
  inviteMember(input: InviteInput): Promise<Member>;
  changeMemberRole(email: string, roleId: string): Promise<Member>;
  removeMember(email: string): Promise<void>;

  // --- Admin: roles -------------------------------------------------------
  /** Built-in assignable roles plus custom roles. */
  listRoles(): Promise<RoleDefinition[]>;
  saveCustomRole(role: RoleDefinition): Promise<RoleDefinition>;
  deleteCustomRole(roleId: string): Promise<void>;

  // --- Lists --------------------------------------------------------------
  readonly shopping: Collection<ShoppingItem, ShoppingItemInput> & {
    /** Delete every checked item. */
    clearChecked(): Promise<void>;
  };
  readonly todos: Collection<Todo, TodoInput>;
  readonly purchases: Collection<PurchasedItem, PurchasedItemInput>;

  // --- Calendar -----------------------------------------------------------
  /** Events, reminders and birthdays entered on the calendar. */
  readonly events: Collection<CalendarEvent, CalendarEventInput>;
  /**
   * Everything dated between `from` and `to` (inclusive, YYYY-MM-DD): events with
   * recurrences expanded, plus to-do due dates, purchases, warranty and document expiries.
   */
  calendar(from: string, to: string): Promise<CalendarOccurrence[]>;

  // --- Documents ----------------------------------------------------------
  readonly docs: DocumentsApi;
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

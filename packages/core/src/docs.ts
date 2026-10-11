import { z } from 'zod';
import { daysBetween, isoDate, itemMeta } from './lists';

// "Document" would shadow the DOM's global type, hence FamilyDocument.

// --- Folders ------------------------------------------------------------------

export const docFolderInputSchema = z.object({
  name: z.string().trim().min(1, 'Folder name is required').max(80),
  /** Null = top level. */
  parentId: z.string().nullable().optional(),
});
export type DocFolderInput = z.infer<typeof docFolderInputSchema>;

export const docFolderSchema = z.object({
  ...itemMeta,
  name: z.string(),
  parentId: z.string().nullable(),
});
export type DocFolder = z.infer<typeof docFolderSchema>;

/** The folders from the top level down to `folderId` (empty for the top level). */
export function folderPath(folders: readonly DocFolder[], folderId: string | null): DocFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: DocFolder[] = [];
  for (let f = folderId ? byId.get(folderId) : undefined; f && !path.includes(f); f = f.parentId ? byId.get(f.parentId) : undefined) {
    path.unshift(f);
  }
  return path;
}

/** Folders directly inside `parentId`, by name. */
export function childFolders(folders: readonly DocFolder[], parentId: string | null): DocFolder[] {
  return folders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
}

/** `folderId` and every folder below it (e.g. the folders a folder can't be moved into). */
export function folderAndDescendants(folders: readonly DocFolder[], folderId: string): Set<string> {
  const out = new Set([folderId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

// --- Documents ----------------------------------------------------------------

/** One uploaded version of a document's file. */
export const docFileSchema = z.object({
  id: z.string().min(1),
  filename: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  uploadedAt: z.string(),
  uploadedBy: z.string().nullable(),
});
export type DocFile = z.infer<typeof docFileSchema>;

export const documentInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  notes: z.string().trim().max(2000).optional(),
  folderId: z.string().nullable().optional(),
  /** Shown on the calendar and the dashboard as it gets close. */
  expiryDate: isoDate.nullable().optional(),
  /** The item purchased this is a receipt or warranty card for. */
  purchaseId: z.string().nullable().optional(),
});
export type DocumentInput = z.infer<typeof documentInputSchema>;

export const familyDocumentSchema = z.object({
  ...itemMeta,
  title: z.string(),
  notes: z.string(),
  folderId: z.string().nullable(),
  expiryDate: isoDate.nullable(),
  purchaseId: z.string().nullable(),
  /** Set = in the trash. */
  deletedAt: z.string().nullable(),
  /** The current version. */
  file: docFileSchema.nullable(),
});
export type FamilyDocument = z.infer<typeof familyDocumentSchema>;

/** Where to PUT a file's bytes before creating (or replacing) a document with `uploadId`. */
export const uploadTicketSchema = z.object({
  uploadId: z.string().min(1),
  url: z.string().min(1),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;

export const DOC_AUDIT_ACTIONS = [
  'upload',
  'replace',
  'restore_version',
  'update',
  'download',
  'trash',
  'restore',
  'purge',
] as const;
export type DocAuditAction = (typeof DOC_AUDIT_ACTIONS)[number];

export const docAuditEventSchema = z.object({
  id: z.string().min(1),
  /** Null once the document has been deleted for good. */
  documentId: z.string().nullable(),
  documentTitle: z.string(),
  action: z.enum(DOC_AUDIT_ACTIONS),
  actorEmail: z.string(),
  detail: z.string(),
  at: z.string(),
});
export type DocAuditEvent = z.infer<typeof docAuditEventSchema>;

// --- Expiry -------------------------------------------------------------------

/** Days ahead that count as "expiring soon", like warranties. */
export const DOC_EXPIRY_WINDOW_DAYS = 60;

export type ExpiryStatus = 'none' | 'active' | 'expiring' | 'expired';

/** A document that expires today is still valid today, so it is "expiring", not "expired". */
export function expiryStatus(
  expiryDate: string | null | undefined,
  today: string,
  windowDays: number = DOC_EXPIRY_WINDOW_DAYS,
): ExpiryStatus {
  if (!expiryDate) return 'none';
  const left = daysBetween(today, expiryDate);
  if (left < 0) return 'expired';
  return left <= windowDays ? 'expiring' : 'active';
}

/** Expired and expiring-soon documents, soonest first. Drives the dashboard widget. */
export function documentAlerts<T extends Pick<FamilyDocument, 'expiryDate'>>(
  docs: readonly T[],
  today: string,
  windowDays: number = DOC_EXPIRY_WINDOW_DAYS,
): (T & { status: 'expiring' | 'expired'; daysLeft: number })[] {
  return docs
    .map((doc) => ({ doc, status: expiryStatus(doc.expiryDate, today, windowDays) }))
    .filter((x): x is { doc: T; status: 'expiring' | 'expired' } => x.status === 'expiring' || x.status === 'expired')
    .map(({ doc, status }) => ({ ...doc, status, daysLeft: daysBetween(today, doc.expiryDate!) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Opened in the browser rather than downloaded. Mirrors INLINE_TYPES in services/api/app/storage.py. */
export const INLINE_CONTENT_TYPES: readonly string[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
];

/** `1536` → `1.5 KB`. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024;
  let i = 0;
  for (; n >= 1024 && i < units.length - 1; i++) n /= 1024;
  return `${n < 10 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n)} ${units[i]}`;
}

import { z } from 'zod';

/** `YYYY-MM-DD`, a calendar date with no time zone. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Fields every family-owned item has. */
export const itemMeta = {
  id: z.string().min(1),
  /** Email of whoever added it; null if they've since left. */
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

// --- Shopping -----------------------------------------------------------------

export const shoppingItemInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  checked: z.boolean().optional(),
});
export type ShoppingItemInput = z.infer<typeof shoppingItemInputSchema>;

export const shoppingItemSchema = z.object({
  ...itemMeta,
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  checked: z.boolean(),
});
export type ShoppingItem = z.infer<typeof shoppingItemSchema>;

// --- To-dos -------------------------------------------------------------------

export const todoInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  dueDate: isoDate.nullable().optional(),
  assigneeEmail: z.string().email().nullable().optional(),
  done: z.boolean().optional(),
});
export type TodoInput = z.infer<typeof todoInputSchema>;

export const todoSchema = z.object({
  ...itemMeta,
  title: z.string(),
  dueDate: isoDate.nullable(),
  assigneeEmail: z.string().nullable(),
  done: z.boolean(),
});
export type Todo = z.infer<typeof todoSchema>;

// --- Items purchased (plan §3) ----------------------------------------------------

export const purchasedItemInputSchema = z
  .object({
    itemName: z.string().trim().min(1, 'Item name is required').max(120),
    specifications: z.string().trim().max(4000).optional(),
    purchaseLink: z
      .string()
      .trim()
      .max(2000)
      .refine((v) => v === '' || /^https?:\/\//i.test(v), 'Link must start with http:// or https://')
      .nullable()
      .optional(),
    boughtDate: isoDate,
    hasWarranty: z.boolean(),
    warrantyExpiryDate: isoDate.nullable().optional(),
  })
  .refine((v) => !v.hasWarranty || !!v.warrantyExpiryDate, {
    message: 'Warranty expiry date is required when the item has a warranty',
    path: ['warrantyExpiryDate'],
  });
export type PurchasedItemInput = z.infer<typeof purchasedItemInputSchema>;

export const purchasedItemSchema = z.object({
  ...itemMeta,
  itemName: z.string(),
  specifications: z.string(),
  purchaseLink: z.string().nullable(),
  boughtDate: isoDate,
  hasWarranty: z.boolean(),
  warrantyExpiryDate: isoDate.nullable(),
});
export type PurchasedItem = z.infer<typeof purchasedItemSchema>;

// --- Warranty sweep -----------------------------------------------------------------

/** Days ahead that count as "expiring soon". Plan §10: 30/60/90, to be made configurable. */
export const WARRANTY_WINDOW_DAYS = 60;

export type WarrantyStatus = 'none' | 'active' | 'expiring' | 'expired';

/** Today's date in the device's time zone, as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). Negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A warranty that ends today still covers today, so it is "expiring", not "expired". */
export function warrantyStatus(
  item: Pick<PurchasedItem, 'hasWarranty' | 'warrantyExpiryDate'>,
  today: string,
  windowDays: number = WARRANTY_WINDOW_DAYS,
): WarrantyStatus {
  if (!item.hasWarranty || !item.warrantyExpiryDate) return 'none';
  const left = daysBetween(today, item.warrantyExpiryDate);
  if (left < 0) return 'expired';
  return left <= windowDays ? 'expiring' : 'active';
}

/** Expired and expiring-soon items, soonest first. Drives the dashboard widget. */
export function warrantyAlerts<T extends Pick<PurchasedItem, 'hasWarranty' | 'warrantyExpiryDate'>>(
  items: readonly T[],
  today: string,
  windowDays: number = WARRANTY_WINDOW_DAYS,
): (T & { status: 'expiring' | 'expired'; daysLeft: number })[] {
  return items
    .map((item) => ({ item, status: warrantyStatus(item, today, windowDays) }))
    .filter((x): x is { item: T; status: 'expiring' | 'expired' } => x.status === 'expiring' || x.status === 'expired')
    .map(({ item, status }) => ({ ...item, status, daysLeft: daysBetween(today, item.warrantyExpiryDate!) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

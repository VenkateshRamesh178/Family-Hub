import {
  can,
  purchasedItemInputSchema,
  todayIso,
  warrantyStatus,
  type FamilyDocument,
  type PurchasedItem,
  type PurchasedItemInput,
} from '@family-hub/core';
import { ExternalLink, Paperclip, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../app/family-context';
import { WarrantyBadge } from '../components/badges';
import { FileButton, canOpenInBrowser, uploadFiles, useOpenFile } from '../components/file-button';
import { Button, Card, CardTitle, Checkbox, EmptyState, ErrorNote, Input, Label, Spinner, Textarea, ViewOnlyNote } from '../components/ui';
import { formatDate } from '../lib/dates';
import { keys, useDocMutation, useDocs, useListMutations, usePurchases } from '../lib/queries';
import { cn } from '../lib/utils';
import { provider } from '../services';

type Filter = 'all' | 'warranty' | 'attention';
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['warranty', 'Under warranty'],
  ['attention', 'Expiring / expired'],
];

/** `null` = closed, `'new'` = adding, otherwise the item being edited. */
type Editing = null | 'new' | PurchasedItem;

export function PurchasesPage() {
  const { role } = useSession();
  const canEdit = can(role, 'lists', 'write');
  const canAttach = can(role, 'docs', 'write');
  const purchases = usePurchases();
  const docs = useDocs();
  const m = useListMutations(keys.purchases, provider.purchases);
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Editing>(null);
  const today = todayIso();

  if (purchases.isPending) return <Spinner />;
  if (purchases.isError) return <ErrorNote error={purchases.error} />;

  const attachments = new Map<string, FamilyDocument[]>();
  for (const d of docs.data ?? []) {
    if (d.purchaseId) attachments.set(d.purchaseId, [...(attachments.get(d.purchaseId) ?? []), d]);
  }

  const shown = purchases.data.filter((p) => {
    const s = warrantyStatus(p, today);
    if (filter === 'warranty') return s === 'active' || s === 'expiring';
    if (filter === 'attention') return s === 'expiring' || s === 'expired';
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Items purchased</h1>
        {canEdit && editing === null && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden />
            Add
          </Button>
        )}
      </div>
      {!canEdit && <ViewOnlyNote />}

      {editing !== null && (
        <PurchaseForm
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === 'new') await m.create.mutateAsync(input);
            else await m.update.mutateAsync({ id: editing.id, patch: input });
            setEditing(null);
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : async () => {
                  await m.remove.mutateAsync(editing.id);
                  setEditing(null);
                }
          }
        />
      )}

      <div className="flex gap-2 overflow-x-auto" role="tablist">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              'min-h-9 shrink-0 rounded-full border px-3 text-sm',
              filter === value
                ? 'border-brand-700 bg-brand-700 text-white'
                : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState>
            {filter === 'all' ? 'Nothing recorded yet. Add big purchases here to keep track of their warranties.' : 'Nothing here.'}
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-3">
          {shown.map((p) => (
            <li key={p.id}>
              <PurchaseCard
                item={p}
                today={today}
                attachments={attachments.get(p.id) ?? []}
                canAttach={canAttach}
                onEdit={canEdit ? () => setEditing(p) : undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PurchaseCard({
  item,
  today,
  attachments,
  canAttach,
  onEdit,
}: {
  item: PurchasedItem;
  today: string;
  attachments: FamilyDocument[];
  canAttach: boolean;
  onEdit?: () => void;
}) {
  return (
    <Card className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{item.itemName}</p>
          <p className="text-xs text-slate-500">Bought {formatDate(item.boughtDate)}</p>
        </div>
        {onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
        )}
      </div>
      {item.specifications && (
        <p className="line-clamp-2 text-sm whitespace-pre-line text-slate-600 dark:text-slate-400">{item.specifications}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <WarrantyBadge item={item} today={today} />
        {item.purchaseLink && (
          <a
            href={item.purchaseLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 underline dark:text-brand-500"
          >
            Where it was bought
            <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </div>
      <Attachments purchase={item} docs={attachments} canAttach={canAttach} />
    </Card>
  );
}

/** Receipts and warranty cards: documents linked to this purchase (they also appear under Documents). */
function Attachments({ purchase, docs, canAttach }: { purchase: PurchasedItem; docs: FamilyDocument[]; canAttach: boolean }) {
  const open = useOpenFile();
  const attach = useDocMutation((files: File[]) => uploadFiles(files, { purchaseId: purchase.id }));
  if (docs.length === 0 && !canAttach) return null;

  return (
    <div className="space-y-2 border-t border-slate-200 pt-2 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {docs.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => open.mutate({ id: d.id, inline: canOpenInBrowser(d) })}
            className="inline-flex min-h-9 max-w-full items-center gap-1 text-xs font-medium text-brand-700 underline dark:text-brand-500"
          >
            <Paperclip className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{d.title}</span>
          </button>
        ))}
        {canAttach && (
          <FileButton multiple size="sm" variant="ghost" loading={attach.isPending} onFiles={(files) => attach.mutate(files)}>
            <Paperclip className="size-4" aria-hidden />
            {docs.length ? 'Attach more' : 'Attach receipt or warranty card'}
          </FileButton>
        )}
      </div>
      <ErrorNote error={attach.error ?? open.error} />
    </div>
  );
}

function PurchaseForm({
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  initial?: PurchasedItem;
  onSave: (input: PurchasedItemInput) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    itemName: initial?.itemName ?? '',
    specifications: initial?.specifications ?? '',
    purchaseLink: initial?.purchaseLink ?? '',
    boughtDate: initial?.boughtDate ?? todayIso(),
    hasWarranty: initial?.hasWarranty ?? false,
    warrantyExpiryDate: initial?.warrantyExpiryDate ?? '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const run = async (which: 'save' | 'delete', fn: () => Promise<void>) => {
    setError(null);
    setBusy(which);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = purchasedItemInputSchema.safeParse({
            ...form,
            purchaseLink: form.purchaseLink.trim() || null,
            warrantyExpiryDate: form.hasWarranty ? form.warrantyExpiryDate || null : null,
          });
          if (!parsed.success) {
            setError(new Error(parsed.error.issues[0]?.message ?? 'Please check the form.'));
            return;
          }
          void run('save', () => onSave(parsed.data));
        }}
      >
        <CardTitle>{initial ? `Edit ${initial.itemName}` : 'Add a purchase'}</CardTitle>
        <div>
          <Label htmlFor="p-name">Item name</Label>
          <Input id="p-name" value={form.itemName} onChange={(e) => set('itemName', e.target.value)} maxLength={120} required />
        </div>
        <div>
          <Label htmlFor="p-specs">Specifications</Label>
          <Textarea
            id="p-specs"
            placeholder="Model, size, colour, serial number…"
            value={form.specifications}
            onChange={(e) => set('specifications', e.target.value)}
            maxLength={4000}
          />
        </div>
        <div>
          <Label htmlFor="p-link">Purchase link (optional)</Label>
          <Input
            id="p-link"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={form.purchaseLink}
            onChange={(e) => set('purchaseLink', e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="p-bought">Bought on</Label>
          <Input id="p-bought" type="date" value={form.boughtDate} onChange={(e) => set('boughtDate', e.target.value)} required />
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <Checkbox checked={form.hasWarranty} onChange={(e) => set('hasWarranty', e.target.checked)} />
          <span className="text-sm font-medium">Has a warranty or guarantee</span>
        </label>
        {form.hasWarranty && (
          <div>
            <Label htmlFor="p-expiry">Warranty expires on</Label>
            <Input
              id="p-expiry"
              type="date"
              value={form.warrantyExpiryDate}
              min={form.boughtDate}
              onChange={(e) => set('warrantyExpiryDate', e.target.value)}
              required
            />
          </div>
        )}
        <p className="text-xs text-slate-500">Once it's saved, attach receipts and warranty cards from the item's card.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy === 'save'} disabled={busy !== null}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy !== null}>
            Cancel
          </Button>
          {onDelete && (
            <Button
              type="button"
              variant="danger"
              loading={busy === 'delete'}
              disabled={busy !== null}
              onClick={() => {
                if (confirm(`Delete ${initial?.itemName}?`)) void run('delete', onDelete);
              }}
            >
              Delete
            </Button>
          )}
        </div>
        <ErrorNote error={error} />
      </form>
    </Card>
  );
}

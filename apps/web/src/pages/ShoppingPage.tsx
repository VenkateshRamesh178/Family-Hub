import { can, type ShoppingItem, type ShoppingItemInput } from '@family-hub/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../app/family-context';
import { Button, Card, Checkbox, EmptyState, ErrorNote, Input, Spinner, ViewOnlyNote } from '../components/ui';
import { keys, useListMutations, useShopping, type ListMutations } from '../lib/queries';
import { cn } from '../lib/utils';
import { provider } from '../services';

export function ShoppingPage() {
  const { role } = useSession();
  const canEdit = can(role, 'lists', 'write');
  const items = useShopping();
  const m = useListMutations(keys.shopping, provider.shopping);
  const qc = useQueryClient();
  const clear = useMutation({
    mutationFn: () => provider.shopping.clearChecked(),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.shopping }),
  });

  if (items.isPending) return <Spinner />;
  if (items.isError) return <ErrorNote error={items.error} />;

  const toBuy = items.data.filter((i) => !i.checked);
  const inCart = items.data.filter((i) => i.checked);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Shopping list</h1>
      {canEdit ? <AddItemForm onAdd={(input) => m.create.mutateAsync(input)} /> : <ViewOnlyNote />}
      <ErrorNote error={m.error ?? clear.error} />

      <Card className="py-1">
        {toBuy.length === 0 ? (
          <EmptyState>{inCart.length ? 'Everything is in the cart.' : 'Nothing to buy. Add something above.'}</EmptyState>
        ) : (
          <ItemList items={toBuy} canEdit={canEdit} m={m} />
        )}
      </Card>

      {inCart.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400">In the cart ({inCart.length})</h2>
            {canEdit && (
              <Button variant="ghost" size="sm" loading={clear.isPending} onClick={() => clear.mutate()}>
                Clear checked
              </Button>
            )}
          </div>
          <Card className="py-1">
            <ItemList items={inCart} canEdit={canEdit} m={m} />
          </Card>
        </section>
      )}
    </div>
  );
}

function AddItemForm({ onAdd }: { onAdd: (input: ShoppingItemInput) => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        try {
          await onAdd({ name, quantity: quantity ? Number(quantity) : null, unit: unit || null });
          setName('');
          setQuantity('');
          setUnit('');
        } catch {
          /* shown by the page's ErrorNote */
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input
        aria-label="Item"
        placeholder="Add an item…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        className="min-w-0 flex-1"
      />
      <Input
        aria-label="Quantity"
        placeholder="Qty"
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        className="w-16 px-2"
      />
      <Input aria-label="Unit" placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={20} className="w-16 px-2" />
      <Button type="submit" aria-label="Add item" loading={busy} disabled={!name.trim()} className="px-3">
        {!busy && <Plus className="size-5" aria-hidden />}
      </Button>
    </form>
  );
}

function ItemList({
  items,
  canEdit,
  m,
}: {
  items: ShoppingItem[];
  canEdit: boolean;
  m: ListMutations<ShoppingItem, ShoppingItemInput>;
}) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 py-2">
          <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
            <Checkbox
              checked={item.checked}
              disabled={!canEdit}
              onChange={(e) => m.update.mutate({ id: item.id, patch: { checked: e.target.checked } })}
            />
            <span className={cn('min-w-0 flex-1 truncate', item.checked && 'text-slate-400 line-through')}>{item.name}</span>
            {item.quantity != null && (
              <span className="shrink-0 text-sm text-slate-500">
                {item.quantity}
                {item.unit ? ` ${item.unit}` : ''}
              </span>
            )}
          </label>
          {canEdit && (
            <Button variant="danger" size="sm" aria-label={`Delete ${item.name}`} onClick={() => m.remove.mutate(item.id)}>
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

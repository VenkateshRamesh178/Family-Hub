import type { Collection } from '@family-hub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { provider } from '../services';

export const keys = {
  family: ['family'] as const,
  members: ['members'] as const,
  roles: ['roles'] as const,
  shopping: ['shopping'] as const,
  todos: ['todos'] as const,
  purchases: ['purchases'] as const,
  events: ['events'] as const,
  /** Prefix of every calendar range query; lists invalidate it because their dates appear there. */
  calendar: ['calendar'] as const,
  /** Prefix of every documents query. */
  docs: ['docs'] as const,
};

export const docKeys = {
  list: [...keys.docs, 'list'] as const,
  trash: [...keys.docs, 'trash'] as const,
  folders: [...keys.docs, 'folders'] as const,
  versions: (id: string) => [...keys.docs, 'versions', id] as const,
  audit: (id?: string) => [...keys.docs, 'audit', id ?? 'all'] as const,
};

export const useMembers = () => useQuery({ queryKey: keys.members, queryFn: () => provider.listMembers() });
export const useShopping = () => useQuery({ queryKey: keys.shopping, queryFn: () => provider.shopping.list() });
export const useTodos = () => useQuery({ queryKey: keys.todos, queryFn: () => provider.todos.list() });
export const usePurchases = () => useQuery({ queryKey: keys.purchases, queryFn: () => provider.purchases.list() });
export const useDocs = () => useQuery({ queryKey: docKeys.list, queryFn: () => provider.docs.list() });
export const useDocTrash = () => useQuery({ queryKey: docKeys.trash, queryFn: () => provider.docs.list({ trash: true }) });
export const useDocFolders = () => useQuery({ queryKey: docKeys.folders, queryFn: () => provider.docs.listFolders() });
export const useDocVersions = (id: string) =>
  useQuery({ queryKey: docKeys.versions(id), queryFn: () => provider.docs.versions(id) });
export const useDocAudit = (id?: string) => useQuery({ queryKey: docKeys.audit(id), queryFn: () => provider.docs.audit(id) });
export const useCalendar = (from: string, to: string) =>
  useQuery({
    queryKey: [...keys.calendar, from, to],
    queryFn: () => provider.calendar(from, to),
    placeholderData: (prev) => prev,
  });

/**
 * Create / update / remove for one list. Updates and removals apply to the cache
 * immediately (so ticking a checkbox feels instant) and roll back if the server refuses.
 * The calendar is refreshed too, since it shows dates from every list.
 */
export function useListMutations<T extends { id: string }, In>(key: readonly string[], col: Collection<T, In>) {
  const qc = useQueryClient();
  const settle = () =>
    Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: keys.calendar })]);

  const optimistic = async (change: (items: T[]) => T[]) => {
    await qc.cancelQueries({ queryKey: key });
    const prev = qc.getQueryData<T[]>(key);
    if (prev) qc.setQueryData<T[]>(key, change(prev));
    return { prev };
  };
  const rollback = (_e: unknown, _v: unknown, ctx?: { prev?: T[] }) => {
    if (ctx?.prev) qc.setQueryData(key, ctx.prev);
  };

  const create = useMutation({ mutationFn: (input: In) => col.create(input), onSettled: settle });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<In> }) => col.update(id, patch),
    onMutate: ({ id, patch }) => optimistic((items) => items.map((i) => (i.id === id ? ({ ...i, ...patch } as T) : i))),
    onError: rollback,
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: (id: string) => col.remove(id),
    onMutate: (id) => optimistic((items) => items.filter((i) => i.id !== id)),
    onError: rollback,
    onSettled: settle,
  });

  return { create, update, remove, error: create.error ?? update.error ?? remove.error };
}

/**
 * Any change to documents (including opening one, which is logged) refreshes every
 * documents query, and the calendar, which shows expiry dates.
 */
export function useDocMutation<V = void, R = unknown>(fn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () =>
      Promise.all([qc.invalidateQueries({ queryKey: keys.docs }), qc.invalidateQueries({ queryKey: keys.calendar })]),
  });
}

export type ListMutations<T extends { id: string }, In> = ReturnType<typeof useListMutations<T, In>>;

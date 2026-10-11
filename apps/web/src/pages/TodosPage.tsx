import { can, todayIso, type Member, type Todo, type TodoInput } from '@family-hub/core';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../app/family-context';
import { DueBadge } from '../components/badges';
import { Button, Card, Checkbox, EmptyState, ErrorNote, Input, Select, Spinner, ViewOnlyNote } from '../components/ui';
import { keys, useListMutations, useMembers, useTodos, type ListMutations } from '../lib/queries';
import { cn } from '../lib/utils';
import { provider } from '../services';

export function TodosPage() {
  const { role, me } = useSession();
  const canEdit = can(role, 'lists', 'write');
  const todos = useTodos();
  const members = useMembers();
  const m = useListMutations(keys.todos, provider.todos);
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const [showDone, setShowDone] = useState(false);

  if (todos.isPending) return <Spinner />;
  if (todos.isError) return <ErrorNote error={todos.error} />;

  const active = (members.data ?? []).filter((x) => x.status === 'active');
  const names = new Map(active.map((x) => [x.email, x.displayName ?? x.email]));
  const visible = todos.data.filter((t) => filter === 'all' || t.assigneeEmail === me.email);
  const open = visible.filter((t) => !t.done);
  const done = visible.filter((t) => t.done);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">To-dos</h1>
      {canEdit ? <AddTodoForm members={active} onAdd={(input) => m.create.mutateAsync(input)} /> : <ViewOnlyNote />}
      <ErrorNote error={m.error} />

      <div role="tablist" className="grid grid-cols-2 rounded-lg bg-slate-200 p-1 dark:bg-slate-800">
        {(
          [
            ['all', 'Everyone'],
            ['mine', 'Assigned to me'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              'min-h-10 rounded-md text-sm font-medium',
              filter === value ? 'bg-white shadow-sm dark:bg-slate-950' : 'text-slate-600 dark:text-slate-400',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Card className="py-1">
        {open.length === 0 ? (
          <EmptyState>{filter === 'mine' ? 'Nothing assigned to you.' : 'All done!'}</EmptyState>
        ) : (
          <TodoList todos={open} names={names} canEdit={canEdit} m={m} />
        )}
      </Card>

      {done.length > 0 && (
        <section className="space-y-2">
          <Button variant="ghost" size="sm" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            {showDone ? 'Hide' : 'Show'} done ({done.length})
          </Button>
          {showDone && (
            <Card className="py-1">
              <TodoList todos={done} names={names} canEdit={canEdit} m={m} />
            </Card>
          )}
        </section>
      )}
    </div>
  );
}

function AddTodoForm({ members, onAdd }: { members: Member[]; onAdd: (input: TodoInput) => Promise<unknown> }) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        try {
          await onAdd({ title, dueDate: dueDate || null, assigneeEmail: assignee || null });
          setTitle('');
          setDueDate('');
          setAssignee('');
        } catch {
          /* shown by the page's ErrorNote */
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex gap-2">
        <Input
          aria-label="To-do"
          placeholder="Add a to-do…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          className="min-w-0 flex-1"
        />
        <Button type="submit" aria-label="Add to-do" loading={busy} disabled={!title.trim()} className="px-3">
          {!busy && <Plus className="size-5" aria-hidden />}
        </Button>
      </div>
      <div className="flex gap-2">
        <Input
          aria-label="Due date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Select
          aria-label="Assign to"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="min-w-0 flex-1"
        >
          <option value="">Unassigned</option>
          {members.map((x) => (
            <option key={x.email} value={x.email}>
              {x.displayName ?? x.email}
            </option>
          ))}
        </Select>
      </div>
    </form>
  );
}

function TodoList({
  todos,
  names,
  canEdit,
  m,
}: {
  todos: Todo[];
  names: Map<string, string>;
  canEdit: boolean;
  m: ListMutations<Todo, TodoInput>;
}) {
  const today = todayIso();
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {todos.map((t) => (
        <li key={t.id} className="flex items-center gap-3 py-2">
          <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
            <Checkbox
              checked={t.done}
              disabled={!canEdit}
              onChange={(e) => m.update.mutate({ id: t.id, patch: { done: e.target.checked } })}
            />
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate', t.done && 'text-slate-400 line-through')}>{t.title}</span>
              {(t.dueDate || t.assigneeEmail) && (
                <span className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {t.dueDate && <DueBadge due={t.dueDate} today={today} done={t.done} />}
                  {t.assigneeEmail && <span>{names.get(t.assigneeEmail) ?? t.assigneeEmail}</span>}
                </span>
              )}
            </span>
          </label>
          {canEdit && (
            <Button variant="danger" size="sm" aria-label={`Delete ${t.title}`} onClick={() => m.remove.mutate(t.id)}>
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

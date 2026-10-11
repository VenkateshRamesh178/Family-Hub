import {
  DOC_EXPIRY_WINDOW_DAYS,
  WARRANTY_WINDOW_DAYS,
  can,
  daysBetween,
  documentAlerts,
  todayIso,
  warrantyAlerts,
  type Resource,
} from '@family-hub/core';
import { CalendarDays, CheckSquare, ChevronRight, FileClock, Package, ShoppingCart, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useSession } from '../app/family-context';
import { DueBadge, ExpiryBadge, WarrantyBadge } from '../components/badges';
import { KIND_STYLE, occurrenceTitle } from '../components/calendar-kinds';
import { Badge, Card, CardTitle, ErrorNote } from '../components/ui';
import { addDays, formatTime, relativeDays } from '../lib/dates';
import { useCalendar, useDocs, useMembers, usePurchases, useShopping, useTodos } from '../lib/queries';
import { cn } from '../lib/utils';

/** To-dos due within this many days show on the dashboard. */
const TODO_WINDOW_DAYS = 7;
/** Calendar entries in the "Coming up" widget. To-dos and warranties have their own widgets. */
const COMING_UP_DAYS = 14;
const MAX_ROWS = 5;

export function DashboardPage() {
  const { me, isAdmin } = useSession();
  const today = todayIso();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Hi, {me.displayName.split(' ')[0]}</h1>
      {isAdmin && <InviteNudge />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ComingUpWidget today={today} />
        <ShoppingWidget />
        <TodosWidget today={today} />
        <WarrantyWidget today={today} />
        <DocumentsWidget today={today} />
      </div>
      <AccessCard />
    </div>
  );
}

function Widget({
  icon: Icon,
  title,
  to,
  count,
  children,
}: {
  icon: LucideIcon;
  title: string;
  to: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-2">
      <Link to={to} className="flex items-center gap-2">
        <Icon className="size-5 text-brand-700 dark:text-brand-500" aria-hidden />
        <CardTitle className="flex-1">{title}</CardTitle>
        {count !== undefined && count > 0 && <Badge tone="brand">{count}</Badge>}
        <ChevronRight className="size-4 text-slate-400" aria-hidden />
      </Link>
      {children}
    </Card>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <ul className="space-y-1.5 text-sm">{children}</ul>;
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}

function ComingUpWidget({ today }: { today: string }) {
  const q = useCalendar(today, addDays(today, COMING_UP_DAYS));
  const items = (q.data ?? []).filter((o) => o.kind === 'event' || o.kind === 'reminder' || o.kind === 'birthday');
  return (
    <Widget icon={CalendarDays} title="Coming up" to="/calendar" count={items.length}>
      {q.isError ? (
        <ErrorNote error={q.error} />
      ) : q.isPending ? (
        <Quiet>Loading…</Quiet>
      ) : items.length === 0 ? (
        <Quiet>Nothing on the calendar in the next {COMING_UP_DAYS} days.</Quiet>
      ) : (
        <Rows>
          {items.slice(0, MAX_ROWS).map((o) => {
            const Icon = KIND_STYLE[o.kind].icon;
            return (
              <li key={o.key} className="flex items-center gap-2">
                <Icon className={cn('size-4 shrink-0', KIND_STYLE[o.kind].text)} aria-label={KIND_STYLE[o.kind].label} />
                <span className="min-w-0 flex-1 truncate">{occurrenceTitle(o)}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {relativeDays(o.date, today)}
                  {o.time ? ` · ${formatTime(o.time)}` : ''}
                </span>
              </li>
            );
          })}
          {items.length > MAX_ROWS && <li className="text-slate-500">+{items.length - MAX_ROWS} more</li>}
        </Rows>
      )}
    </Widget>
  );
}

function ShoppingWidget() {
  const q = useShopping();
  const toBuy = q.data?.filter((i) => !i.checked) ?? [];
  return (
    <Widget icon={ShoppingCart} title="Shopping" to="/shopping" count={toBuy.length}>
      {q.isError ? (
        <ErrorNote error={q.error} />
      ) : q.isPending ? (
        <Quiet>Loading…</Quiet>
      ) : toBuy.length === 0 ? (
        <Quiet>Nothing to buy.</Quiet>
      ) : (
        <Rows>
          {toBuy.slice(0, MAX_ROWS).map((i) => (
            <li key={i.id} className="flex justify-between gap-2">
              <span className="truncate">{i.name}</span>
              {i.quantity != null && (
                <span className="shrink-0 text-slate-500">
                  {i.quantity}
                  {i.unit ? ` ${i.unit}` : ''}
                </span>
              )}
            </li>
          ))}
          {toBuy.length > MAX_ROWS && <li className="text-slate-500">+{toBuy.length - MAX_ROWS} more</li>}
        </Rows>
      )}
    </Widget>
  );
}

function TodosWidget({ today }: { today: string }) {
  const q = useTodos();
  const members = useMembers();
  const names = new Map((members.data ?? []).map((x) => [x.email, x.displayName ?? x.email]));
  const soon = (q.data ?? []).filter((t) => !t.done && t.dueDate && daysBetween(today, t.dueDate) <= TODO_WINDOW_DAYS);
  const undated = (q.data ?? []).filter((t) => !t.done && !t.dueDate).length;

  return (
    <Widget icon={CheckSquare} title="Due this week" to="/todos" count={soon.length}>
      {q.isError ? (
        <ErrorNote error={q.error} />
      ) : q.isPending ? (
        <Quiet>Loading…</Quiet>
      ) : soon.length === 0 ? (
        <Quiet>Nothing due in the next {TODO_WINDOW_DAYS} days.</Quiet>
      ) : (
        <Rows>
          {soon.slice(0, MAX_ROWS).map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {t.title}
                {t.assigneeEmail && <span className="text-slate-500"> · {names.get(t.assigneeEmail) ?? t.assigneeEmail}</span>}
              </span>
              <DueBadge due={t.dueDate!} today={today} />
            </li>
          ))}
          {soon.length > MAX_ROWS && <li className="text-slate-500">+{soon.length - MAX_ROWS} more</li>}
        </Rows>
      )}
      {undated > 0 && <Quiet>Plus {undated} with no due date.</Quiet>}
    </Widget>
  );
}

function WarrantyWidget({ today }: { today: string }) {
  const q = usePurchases();
  const alerts = warrantyAlerts(q.data ?? [], today);
  return (
    <Widget icon={Package} title="Warranties expiring soon" to="/purchases" count={alerts.length}>
      {q.isError ? (
        <ErrorNote error={q.error} />
      ) : q.isPending ? (
        <Quiet>Loading…</Quiet>
      ) : alerts.length === 0 ? (
        <Quiet>No warranties ending in the next {WARRANTY_WINDOW_DAYS} days.</Quiet>
      ) : (
        <Rows>
          {alerts.slice(0, MAX_ROWS).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{p.itemName}</span>
              <WarrantyBadge item={p} today={today} />
            </li>
          ))}
          {alerts.length > MAX_ROWS && <li className="text-slate-500">+{alerts.length - MAX_ROWS} more</li>}
        </Rows>
      )}
    </Widget>
  );
}

function DocumentsWidget({ today }: { today: string }) {
  const q = useDocs();
  const alerts = documentAlerts(q.data ?? [], today);
  return (
    <Widget icon={FileClock} title="Documents expiring soon" to="/docs" count={alerts.length}>
      {q.isError ? (
        <ErrorNote error={q.error} />
      ) : q.isPending ? (
        <Quiet>Loading…</Quiet>
      ) : alerts.length === 0 ? (
        <Quiet>No documents expiring in the next {DOC_EXPIRY_WINDOW_DAYS} days.</Quiet>
      ) : (
        <Rows>
          {alerts.slice(0, MAX_ROWS).map((d) => (
            <li key={d.id}>
              <Link to={`/docs?doc=${encodeURIComponent(d.id)}`} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{d.title}</span>
                <ExpiryBadge expiryDate={d.expiryDate} today={today} />
              </Link>
            </li>
          ))}
          {alerts.length > MAX_ROWS && <li className="text-slate-500">+{alerts.length - MAX_ROWS} more</li>}
        </Rows>
      )}
    </Widget>
  );
}

function InviteNudge() {
  const members = useMembers();
  if (!members.data || members.data.length > 1) return null;
  return (
    <Card className="flex items-center justify-between gap-3 border-brand-100 bg-brand-50 dark:border-brand-800 dark:bg-brand-800/20">
      <p className="text-sm">It's just you so far. Invite your family to share lists.</p>
      <Link to="/admin" className="shrink-0 text-sm font-medium text-brand-700 underline dark:text-brand-500">
        Invite
      </Link>
    </Card>
  );
}

const MODULES: { resource: Resource; label: string }[] = [
  { resource: 'lists', label: 'Shopping, to-dos, purchases & calendar' },
  { resource: 'docs', label: 'Shared documents (coming soon)' },
  { resource: 'chat', label: 'Family chat (coming soon)' },
  { resource: 'members', label: 'Members & roles' },
];

function AccessCard() {
  const { role } = useSession();
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <CardTitle>Your access</CardTitle>
        <Badge tone="brand">{role.name}</Badge>
      </div>
      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {MODULES.map(({ resource, label }) => (
          <li key={resource} className="flex items-center justify-between py-2">
            <span>{label}</span>
            {can(role, resource, 'write') ? <Badge tone="ok">Can edit</Badge> : <Badge>View only</Badge>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

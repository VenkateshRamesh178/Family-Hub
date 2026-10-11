import {
  EVENT_KINDS,
  RECURRENCES,
  can,
  calendarEventInputSchema,
  todayIso,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarOccurrence,
  type EventKind,
  type Recurrence,
} from '@family-hub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Copy, Link2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useSession } from '../app/family-context';
import { KIND_STYLE, occurrenceTitle, sourcePath } from '../components/calendar-kinds';
import { Button, Card, CardTitle, EmptyState, ErrorNote, Input, Label, Select, Spinner, Textarea } from '../components/ui';
import { addMonths, formatDay, formatMonth, formatTime, monthGrid, WEEKDAY_INITIALS } from '../lib/dates';
import { keys, useCalendar, useListMutations } from '../lib/queries';
import { cn } from '../lib/utils';
import { provider } from '../services';

const KIND_LABELS: Record<EventKind, string> = { event: 'Event', reminder: 'Reminder', birthday: 'Birthday' };
const REPEAT_LABELS: Record<Recurrence, string> = {
  none: "Doesn't repeat",
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
};

/** `null` = closed; `{ date }` = adding on that date; otherwise the event being edited. */
type Editing = null | { date: string } | CalendarEvent;

export function CalendarPage() {
  const { role } = useSession();
  const canEdit = can(role, 'calendar', 'write');
  const today = todayIso();
  const [month, setMonth] = useState(() => `${today.slice(0, 7)}-01`);
  const [selected, setSelected] = useState(today);
  const [editing, setEditing] = useState<Editing>(null);

  const weeks = useMemo(() => monthGrid(month), [month]);
  const from = weeks[0]![0]!;
  const to = weeks[5]![6]!;
  const range = useCalendar(from, to);
  const events = useQuery({ queryKey: keys.events, queryFn: () => provider.events.list(), enabled: canEdit });
  const m = useListMutations(keys.events, provider.events);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarOccurrence[]>();
    for (const o of range.data ?? []) map.set(o.date, [...(map.get(o.date) ?? []), o]);
    return map;
  }, [range.data]);
  const dayItems = byDay.get(selected) ?? [];

  const goTo = (offset: number) => {
    const next = addMonths(month, offset);
    setMonth(next);
    setSelected(next.slice(0, 7) === today.slice(0, 7) ? today : next);
  };

  const openEvent = (o: CalendarOccurrence) => {
    const e = events.data?.find((x) => x.id === o.sourceId);
    if (e) setEditing(e);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Calendar</h1>
        {canEdit && editing === null && (
          <Button size="sm" onClick={() => setEditing({ date: selected })}>
            <Plus className="size-4" aria-hidden />
            Add
          </Button>
        )}
      </div>

      {editing !== null && (
        <EventForm
          key={'id' in editing ? editing.id : `new-${editing.date}`}
          initial={'id' in editing ? editing : undefined}
          defaultDate={'id' in editing ? editing.startDate : editing.date}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            if ('id' in editing) await m.update.mutateAsync({ id: editing.id, patch: input });
            else await m.create.mutateAsync(input);
            setSelected(input.startDate);
            setEditing(null);
          }}
          onDelete={
            'id' in editing
              ? async () => {
                  await m.remove.mutateAsync(editing.id);
                  setEditing(null);
                }
              : undefined
          }
        />
      )}

      <Card className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => goTo(-1)}>
            <ChevronLeft className="size-5" aria-hidden />
          </Button>
          <button
            type="button"
            className="font-semibold"
            onClick={() => {
              setMonth(`${today.slice(0, 7)}-01`);
              setSelected(today);
            }}
            title="Back to today"
          >
            {formatMonth(month)}
          </button>
          <Button variant="ghost" size="sm" aria-label="Next month" onClick={() => goTo(1)}>
            <ChevronRight className="size-5" aria-hidden />
          </Button>
        </div>

        <div className="grid grid-cols-7 text-center text-xs text-slate-500" aria-hidden>
          {WEEKDAY_INITIALS.map((d, i) => (
            <span key={i} className="py-1">
              {d}
            </span>
          ))}
        </div>
        <div role="grid" aria-label={formatMonth(month)} className="grid grid-cols-7 gap-0.5">
          {weeks.flat().map((day) => {
            const items = byDay.get(day) ?? [];
            const inMonth = day.slice(0, 7) === month.slice(0, 7);
            const kinds = [...new Set(items.map((o) => o.kind))].slice(0, 3);
            return (
              <button
                key={day}
                type="button"
                role="gridcell"
                aria-selected={day === selected}
                aria-label={`${formatDay(day)}${items.length ? `, ${items.length} item${items.length > 1 ? 's' : ''}` : ''}`}
                onClick={() => setSelected(day)}
                className={cn(
                  'flex aspect-square min-h-11 flex-col items-center justify-center gap-1 rounded-lg text-sm',
                  !inMonth && 'text-slate-400 dark:text-slate-600',
                  day === selected
                    ? 'bg-brand-700 text-white'
                    : day === today
                      ? 'ring-2 ring-brand-600 ring-inset'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                <span className={cn(day === today && day !== selected && 'font-bold text-brand-700 dark:text-brand-500')}>
                  {Number(day.slice(8))}
                </span>
                <span className="flex h-1.5 gap-0.5">
                  {kinds.map((k) => (
                    <span key={k} className={cn('size-1.5 rounded-full', day === selected ? 'bg-white' : KIND_STYLE[k].dot)} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        {range.isError && <ErrorNote error={range.error} />}
      </Card>

      <section className="space-y-2" aria-live="polite">
        <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400">
          {selected === today ? 'Today' : formatDay(selected)}
        </h2>
        <Card className="py-1">
          {range.isPending ? (
            <Spinner />
          ) : dayItems.length === 0 ? (
            <EmptyState>Nothing on this day.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {dayItems.map((o) => (
                <AgendaRow key={o.key} o={o} onEdit={canEdit && o.sourceType === 'event' ? () => openEvent(o) : undefined} />
              ))}
            </ul>
          )}
        </Card>
        <ErrorNote error={m.error} />
      </section>

      <Legend />
      <SyncCard />
    </div>
  );
}

function AgendaRow({ o, onEdit }: { o: CalendarOccurrence; onEdit?: () => void }) {
  const style = KIND_STYLE[o.kind];
  const Icon = style.icon;
  const path = sourcePath(o);
  const body = (
    <>
      <Icon className={cn('size-5 shrink-0', style.text)} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate', o.done && 'text-slate-400 line-through')}>{occurrenceTitle(o)}</span>
        <span className="block truncate text-xs text-slate-500">
          {style.label}
          {o.time ? ` · ${formatTime(o.time)}` : ''}
          {o.recurrence && o.recurrence !== 'none' && o.kind !== 'birthday' ? ` · ${REPEAT_LABELS[o.recurrence].toLowerCase()}` : ''}
          {o.notes ? ` · ${o.notes}` : ''}
        </span>
      </span>
    </>
  );
  const rowClass = 'flex min-h-14 w-full items-center gap-3 py-2 text-left';
  return (
    <li>
      {onEdit ? (
        <button type="button" className={rowClass} onClick={onEdit}>
          {body}
        </button>
      ) : path ? (
        <Link to={path} className={rowClass}>
          {body}
          <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
        </Link>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      {Object.entries(KIND_STYLE).map(([k, s]) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className={cn('size-2 rounded-full', s.dot)} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function EventForm({
  initial,
  defaultDate,
  onSave,
  onCancel,
  onDelete,
}: {
  initial?: CalendarEvent;
  defaultDate: string;
  onSave: (input: CalendarEventInput) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    kind: initial?.kind ?? ('event' as EventKind),
    startDate: initial?.startDate ?? defaultDate,
    startTime: initial?.startTime?.slice(0, 5) ?? '',
    recurrence: initial?.recurrence ?? ('none' as Recurrence),
    notes: initial?.notes ?? '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const isBirthday = form.kind === 'birthday';

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
          const parsed = calendarEventInputSchema.safeParse({
            ...form,
            startTime: isBirthday ? null : form.startTime || null,
            recurrence: isBirthday ? 'yearly' : form.recurrence,
          });
          if (!parsed.success) {
            setError(new Error(parsed.error.issues[0]?.message ?? 'Please check the form.'));
            return;
          }
          void run('save', () => onSave(parsed.data));
        }}
      >
        <CardTitle>{initial ? `Edit ${KIND_LABELS[initial.kind].toLowerCase()}` : 'Add to the calendar'}</CardTitle>

        <div role="radiogroup" aria-label="Type" className="grid grid-cols-3 rounded-lg bg-slate-200 p-1 dark:bg-slate-800">
          {EVENT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={form.kind === k}
              onClick={() => set('kind', k)}
              className={cn(
                'min-h-10 rounded-md text-sm font-medium',
                form.kind === k ? 'bg-white shadow-sm dark:bg-slate-950' : 'text-slate-600 dark:text-slate-400',
              )}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>

        <div>
          <Label htmlFor="ev-title">{isBirthday ? 'Whose birthday?' : 'Title'}</Label>
          <Input
            id="ev-title"
            value={form.title}
            placeholder={isBirthday ? 'Ana' : form.kind === 'reminder' ? 'Renew car insurance' : 'School play'}
            onChange={(e) => set('title', e.target.value)}
            maxLength={200}
            required
          />
        </div>

        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="ev-date">{isBirthday ? 'Date of birth' : 'Date'}</Label>
            <Input id="ev-date" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} required />
          </div>
          {!isBirthday && (
            <div className="w-32">
              <Label htmlFor="ev-time">Time</Label>
              <Input id="ev-time" type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
            </div>
          )}
        </div>
        {isBirthday ? (
          <p className="text-xs text-slate-500">
            Repeats every year. Don't know the year? Use this year's date and the age won't be shown.
          </p>
        ) : (
          <div>
            <Label htmlFor="ev-repeat">Repeats</Label>
            <Select id="ev-repeat" value={form.recurrence} onChange={(e) => set('recurrence', e.target.value as Recurrence)}>
              {RECURRENCES.map((r) => (
                <option key={r} value={r}>
                  {REPEAT_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor="ev-notes">Notes</Label>
          <Textarea id="ev-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={2000} />
        </div>
        {(form.kind === 'reminder' || isBirthday) && (
          <p className="text-xs text-slate-500">
            Phones subscribed to the family calendar get an alert{' '}
            {isBirthday ? 'at 9am on the day' : form.startTime ? 'at this time' : 'at 9am on the day'}.
          </p>
        )}

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
                if (confirm(`Delete "${initial?.title}"${initial?.recurrence !== 'none' ? ' and all its repeats' : ''}?`))
                  void run('delete', onDelete);
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

// --- Sync to phone / other calendars ---------------------------------------------------

const feedKey = ['calendar-feed'] as const;

function SyncCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: feedKey, queryFn: () => provider.calendarFeedStatus() });
  // The link itself is only available right after creating it (the server keeps a hash).
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: () => provider.createCalendarFeed(),
    onSuccess: ({ path }) => {
      setUrl(new URL(path, window.location.origin).href);
      void qc.invalidateQueries({ queryKey: feedKey });
    },
  });
  const revoke = useMutation({
    mutationFn: () => provider.revokeCalendarFeed(),
    onSuccess: () => {
      setUrl(null);
      void qc.invalidateQueries({ queryKey: feedKey });
    },
  });

  const active = status.data?.active ?? false;

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="size-5 text-brand-700 dark:text-brand-500" aria-hidden />
        <CardTitle>Show on your phone's calendar</CardTitle>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Subscribe from Google Calendar, Apple Calendar or Outlook to see the family calendar there, including to-dos,
        purchases and warranty dates. It's read-only and updates automatically (Google can take a few hours).
      </p>

      {url ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Your private link (shown once, so copy it now):</p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={url}
              aria-label="Calendar link"
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 text-sm"
            />
            <Button
              variant="secondary"
              aria-label="Copy link"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              <Copy className="size-4" aria-hidden />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <a
            href={url.replace(/^https?:/, 'webcal:')}
            className="inline-block text-sm font-medium text-brand-700 underline dark:text-brand-500"
          >
            Open in this device's calendar app
          </a>
          <details className="text-sm text-slate-600 dark:text-slate-400">
            <summary className="cursor-pointer font-medium">How to add it</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong>Google Calendar</strong> (computer): Other calendars → + → From URL → paste the link. It then
                appears on your Android phone too.
              </li>
              <li>
                <strong>iPhone / Mac</strong>: tap "Open in this device's calendar app", or Settings → Calendar →
                Accounts → Add Subscribed Calendar.
              </li>
              <li>
                <strong>Outlook</strong>: Add calendar → Subscribe from web.
              </li>
            </ul>
          </details>
          <p className="text-xs text-slate-500">
            Anyone with this link can see the family calendar. If it gets shared by mistake, make a new one.
          </p>
        </div>
      ) : active ? (
        <p className="text-sm">
          ✓ You have a calendar link
          {status.data?.createdAt ? ` (made ${new Date(status.data.createdAt).toLocaleDateString()})` : ''}. Use the
          same link on all your devices. Lost it? Make a new one; calendars using the old link will stop updating.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant={active ? 'secondary' : 'primary'}
          loading={create.isPending}
          onClick={() => {
            if (!active || confirm('Make a new link? Calendars using the current link will stop updating.')) create.mutate();
          }}
        >
          {active ? 'Make a new link' : 'Get calendar link'}
        </Button>
        {active && (
          <Button variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate()}>
            Turn off
          </Button>
        )}
      </div>
      <ErrorNote error={status.error ?? create.error ?? revoke.error} />
    </Card>
  );
}

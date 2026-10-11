import type { CalendarOccurrence, OccurrenceKind } from '@family-hub/core';
import { Bell, CalendarDays, CheckSquare, FileClock, Gift, Package, ShieldAlert, type LucideIcon } from 'lucide-react';

/** How each kind of calendar entry looks, and where tapping a derived entry goes. */
export const KIND_STYLE: Record<OccurrenceKind, { label: string; icon: LucideIcon; dot: string; text: string }> = {
  event: { label: 'Event', icon: CalendarDays, dot: 'bg-brand-600', text: 'text-brand-700 dark:text-brand-500' },
  reminder: { label: 'Reminder', icon: Bell, dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  birthday: { label: 'Birthday', icon: Gift, dot: 'bg-pink-500', text: 'text-pink-700 dark:text-pink-400' },
  todo: { label: 'To-do due', icon: CheckSquare, dot: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-400' },
  warranty: { label: 'Warranty ends', icon: ShieldAlert, dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400' },
  purchase: { label: 'Bought', icon: Package, dot: 'bg-slate-400', text: 'text-slate-600 dark:text-slate-400' },
  document: { label: 'Document expires', icon: FileClock, dot: 'bg-violet-500', text: 'text-violet-700 dark:text-violet-400' },
};

export function sourcePath(o: CalendarOccurrence): string | null {
  if (o.sourceType === 'todo') return '/todos';
  if (o.sourceType === 'purchase') return '/purchases';
  if (o.sourceType === 'document') return `/docs?doc=${encodeURIComponent(o.sourceId)}`;
  return null;
}

/** "Ana · turns 36" for birthdays; the title otherwise. */
export function occurrenceTitle(o: CalendarOccurrence): string {
  return o.kind === 'birthday' && o.age ? `${o.title} · turns ${o.age}` : o.title;
}

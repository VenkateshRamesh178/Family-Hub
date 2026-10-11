import { daysBetween, todayIso } from '@family-hub/core';

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** `2026-10-03` → `3 Oct 2026` (in the user's locale). */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(`${iso}T00:00:00Z`));
}

/** "Today", "Tomorrow", "In 5 days", "Yesterday", "3 days ago". */
export function relativeDays(iso: string, today: string): string {
  const d = daysBetween(today, iso);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  return d > 0 ? `In ${d} days` : `${-d} days ago`;
}

/** Adds days to a YYYY-MM-DD date. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First day of the month containing `iso`, shifted by `months`. */
export function addMonths(iso: string, months: number): string {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return todayIso(new Date(y, m - 1 + months, 1));
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** A server timestamp in the user's time zone, e.g. `11 Oct 2026, 14:30`. */
export const formatDateTime = (timestamp: string) => dateTimeFormat.format(new Date(timestamp));

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const narrowWeekday = new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' });

export const formatMonth = (iso: string) => monthFormat.format(new Date(`${iso}T00:00:00Z`));
/** `Sunday, 11 October` */
export const formatDay = (iso: string) => weekdayFormat.format(new Date(`${iso}T00:00:00Z`));

/** Single-letter weekday names, Monday first. */
export const WEEKDAY_INITIALS = Array.from({ length: 7 }, (_, i) =>
  narrowWeekday.format(new Date(Date.UTC(2024, 0, 1 + i))),
);

/** The six Monday-first weeks shown for the month containing `iso`. */
export function monthGrid(iso: string): string[][] {
  const first = `${iso.slice(0, 7)}-01`;
  const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const start = addDays(first, -weekday);
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

/** `14:30:00` → `14:30` (or `2:30 pm`, depending on locale). */
export function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

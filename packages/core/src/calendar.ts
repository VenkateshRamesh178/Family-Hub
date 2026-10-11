import { z } from 'zod';
import { isoDate } from './lists';

export const EVENT_KINDS = ['event', 'reminder', 'birthday'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const RECURRENCES = ['none', 'weekly', 'monthly', 'yearly'] as const;
export type Recurrence = (typeof RECURRENCES)[number];

/** Everything that can appear on the calendar: entered events plus dated items from other modules. */
export const OCCURRENCE_KINDS = [...EVENT_KINDS, 'todo', 'warranty', 'purchase', 'document'] as const;
export type OccurrenceKind = (typeof OCCURRENCE_KINDS)[number];

/** `HH:MM`, optionally with seconds (the API sends `HH:MM:SS`). */
export const clockTime = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Use HH:MM');

export const calendarEventInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  kind: z.enum(EVENT_KINDS),
  startDate: isoDate,
  /** Null = all day. Birthdays are always all day and yearly (the API enforces it). */
  startTime: clockTime.nullable().optional(),
  recurrence: z.enum(RECURRENCES).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CalendarEventInput = z.infer<typeof calendarEventInputSchema>;

export const calendarEventSchema = z.object({
  id: z.string().min(1),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  title: z.string(),
  kind: z.enum(EVENT_KINDS),
  startDate: isoDate,
  startTime: clockTime.nullable(),
  recurrence: z.enum(RECURRENCES),
  notes: z.string(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

/** One dated entry in a calendar range. Recurring events appear once per occurrence. */
export const calendarOccurrenceSchema = z.object({
  key: z.string().min(1),
  date: isoDate,
  time: clockTime.nullable().optional(),
  title: z.string(),
  kind: z.enum(OCCURRENCE_KINDS),
  sourceType: z.enum(['event', 'todo', 'purchase', 'document']),
  sourceId: z.string().min(1),
  notes: z.string().optional(),
  recurrence: z.enum(RECURRENCES).optional(),
  /** Birthdays: the age reached that day, when the birth year is known. */
  age: z.number().int().nullable().optional(),
  /** To-dos: whether it's done. */
  done: z.boolean().nullable().optional(),
});
export type CalendarOccurrence = z.infer<typeof calendarOccurrenceSchema>;

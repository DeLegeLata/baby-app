// Sleep records, per-date changes, baths and settings. The columns mirror the
// Supabase tables in supabase/toddler.sql, so a row can be uploaded as-is.
import { z } from 'zod';
import { CLOCK_PATTERN, parseClock, type DateKey } from './time';

export const SCHEMA_VERSION = 1;

export type SleepKind = 'night' | 'nap' | 'catnap';
export const SLEEP_KINDS: SleepKind[] = ['night', 'nap', 'catnap'];

export const PLACES = ['bed', 'daycare', 'car', 'stroller', 'parents_bed', 'other'] as const;
export type Place = (typeof PLACES)[number];

export const MOODS = ['happy', 'fine', 'grumpy'] as const;
export type Mood = (typeof MOODS)[number];

export const OFF_TAGS = ['sick', 'teething', 'travel', 'other'] as const;
export type OffTag = (typeof OFF_TAGS)[number];

/** What he did before a sleep, in the order a day usually runs. */
export const ACTIVITIES = [
  'outdoors',
  'active_play',
  'quiet_play',
  'screen',
  'snack',
  'bath',
  'books',
  'music',
  'car'
] as const;
export type Activity = (typeof ACTIVITIES)[number];

export const ACTIVITY_LABEL: Record<Activity, string> = {
  outdoors: 'Park or outdoors',
  active_play: 'Active play',
  quiet_play: 'Quiet play',
  screen: 'TV or screen',
  snack: 'Snack or milk',
  bath: 'Bath',
  books: 'Books',
  music: 'Songs or music',
  car: 'Car ride'
};

export const KIND_LABEL: Record<SleepKind, string> = { night: 'Night', nap: 'Nap', catnap: 'Catnap' };
export const PLACE_LABEL: Record<Place, string> = {
  bed: 'Bed',
  daycare: 'Daycare',
  car: 'Car',
  stroller: 'Stroller',
  parents_bed: "Our bed",
  other: 'Other'
};
export const MOOD_LABEL: Record<Mood, string> = { happy: 'Happy', fine: 'Fine', grumpy: 'Grumpy' };
export const OFF_LABEL: Record<OffTag, string> = {
  sick: 'Sick',
  teething: 'Teething',
  travel: 'Travel',
  other: 'Unusual day'
};

/** A night waking. `end` is null while he is still awake. */
export type Waking = { start: string; end: string | null };

type SyncFields = {
  household_id: string;
  child_id: string;
  logged_by: string;
  rev: number;
  updated_at: string;
  deleted_at: string | null;
  schema_version: number;
  /** local only, never uploaded */
  synced: 0 | 1;
};

export type Sleep = SyncFields & {
  id: string;
  kind: SleepKind;
  /** when he went into bed; null if not recorded */
  in_bed_at: string | null;
  /** null while he is in bed but not yet asleep */
  asleep_at: string | null;
  /** null while the sleep is still running */
  woke_at: string | null;
  wakings: Waking[];
  place: Place | null;
  mood: Mood | null;
  note: string | null;
  /** what he did before this sleep (absent on rows logged before this field existed) */
  activities?: Activity[];
};

/** A bath. Baths given as part of a bedtime routine also count (see the "bath" activity). */
export type Bath = SyncFields & {
  id: string;
  at: string;
  note: string | null;
};

export type NoSleepWindow = { start: string; end: string; label: string };

/**
 * One-off changes for a date. A key that is present replaces the template for
 * that day; a null value means "none that day" (no must-be-up, no nap).
 */
export type DayOverride = {
  must_be_up?: string | null;
  nap_start?: string | null;
  nap_end?: string | null;
  latest_bedtime?: string | null;
  no_sleep?: NoSleepWindow[];
  daycare?: boolean;
};

export type DayRow = SyncFields & {
  /** `${child_id}:${date}`, so both phones address the same row */
  id: string;
  date: DateKey;
  override: DayOverride;
  /** an unusual day: still shown, but left out of the learning */
  off_tag: OffTag | null;
  /** he did not nap: daycare's report, or a parent's on a home day */
  no_nap: boolean;
  note: string | null;
};

export const dayId = (childId: string, date: DateKey) => `${childId}:${date}`;

export const SLEEP_COLUMNS = [
  'id',
  'household_id',
  'child_id',
  'kind',
  'in_bed_at',
  'asleep_at',
  'woke_at',
  'wakings',
  'place',
  'mood',
  'note',
  'activities',
  'logged_by',
  'rev',
  'updated_at',
  'deleted_at',
  'schema_version'
] as const;

export const BATH_COLUMNS = [
  'id',
  'household_id',
  'child_id',
  'at',
  'note',
  'logged_by',
  'rev',
  'updated_at',
  'deleted_at',
  'schema_version'
] as const;

export const DAY_COLUMNS = [
  'id',
  'household_id',
  'child_id',
  'date',
  'override',
  'off_tag',
  'no_nap',
  'note',
  'logged_by',
  'rev',
  'updated_at',
  'deleted_at',
  'schema_version'
] as const;

export function toRow<T extends Record<string, unknown>>(record: T, columns: readonly string[]) {
  const row = {} as Record<string, unknown>;
  for (const column of columns) row[column] = record[column];
  return row;
}

// --- Settings -----------------------------------------------------------------

/** Every time on screen runs through Intl, which throws on an unknown zone. */
function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return zone.length > 0;
  } catch {
    return false;
  }
}

const clock = z.string().regex(CLOCK_PATTERN, 'Use a 24-hour time such as 07:00');

const windowSchema = z.object({
  start: clock,
  end: clock,
  label: z.string().max(40)
});

export const scheduleSchema = z
  .object({
    must_be_up: clock.nullable(),
    nap_start: clock.nullable(),
    nap_end: clock.nullable(),
    latest_bedtime: clock.nullable(),
    no_sleep: z.array(windowSchema)
  })
  .superRefine((s, ctx) => {
    if ((s.nap_start === null) !== (s.nap_end === null)) {
      ctx.addIssue({ code: 'custom', message: 'Give the nap window both a start and an end' });
    } else if (s.nap_start && s.nap_end && parseClock(s.nap_end) <= parseClock(s.nap_start)) {
      ctx.addIssue({ code: 'custom', message: 'The nap window must end after it starts' });
    }
  });

export type Schedule = z.infer<typeof scheduleSchema>;

export const settingsSchema = z.object({
  schedule: scheduleSchema,
  /** ISO weekdays he is at daycare (Monday is 1) */
  daycare_days: z.array(z.number().int().min(1).max(7)),
  routine_min: z.number().int().min(0).max(120),
  /** starting point for how long he takes to fall asleep, until the app learns it */
  settle_min: z.number().int().min(0).max(90),
  /** starting points for his usual night, until the app learns them */
  usual_bedtime: clock,
  usual_wake: clock,
  reminder_lead_min: z.number().int().min(0).max(120),
  time_zone: z.string().refine(isTimeZone, 'Use a time zone name such as America/Toronto'),
  night_look: z.enum(['auto', 'off']),
  // Added after the first release, so settings saved before then still load:
  // a missing value takes its default instead of failing the whole object.
  /** a bath is due this many days after the last one */
  bath_every_days: z.number().int().min(1).max(14).default(3),
  /** when the bath reminder goes out on a day a bath is due; null for none */
  bath_remind_at: clock.nullable().default('17:00'),
  /** when the settings last changed on either phone; the newer copy wins */
  updated_at: z.string()
});

export type AppSettings = z.infer<typeof settingsSchema>;

// The schedule times are placeholders until the real daycare times go in.
export const DEFAULT_SETTINGS: AppSettings = {
  schedule: {
    must_be_up: '07:00',
    nap_start: '12:30',
    nap_end: '14:30',
    latest_bedtime: '20:30',
    no_sleep: []
  },
  daycare_days: [1, 2, 3, 4, 5],
  routine_min: 20,
  settle_min: 15,
  usual_bedtime: '20:15',
  usual_wake: '06:30',
  reminder_lead_min: 30,
  time_zone: 'America/Toronto',
  night_look: 'auto',
  bath_every_days: 3,
  bath_remind_at: '17:00',
  updated_at: '1970-01-01T00:00:00.000Z'
};

export type Child = { name: string; birth_at: string | null };

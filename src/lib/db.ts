// Local storage. Every write lands here first and shows on screen immediately;
// the outbox (synced = 0) uploads whenever the app can reach Supabase.
import Dexie, { type Table } from 'dexie';
import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  dayId,
  settingsSchema,
  type AppSettings,
  type Child,
  type DayRow,
  type Sleep,
  type SleepKind
} from './model';
import type { DateKey } from './time';

export type Meta = { key: string; value: unknown };

class SleepDb extends Dexie {
  /** the newborn app's feeds and diapers: kept on the phone, no longer shown */
  entries!: Table<Record<string, unknown>, string>;
  meta!: Table<Meta, string>;
  sleeps!: Table<Sleep, string>;
  days!: Table<DayRow, string>;

  constructor() {
    super('baby-app');
    this.version(1).stores({
      entries: 'id, kind, started_at, synced, deleted_at, epoch',
      meta: 'key'
    });
    this.version(2).stores({
      sleeps: 'id, kind, asleep_at, synced',
      days: 'id, date, synced'
    });
  }
}

export const db = new SleepDb();

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

// --- Settings and the child ------------------------------------------------------

export async function loadSettings(): Promise<AppSettings> {
  const stored = await getMeta<unknown>('sleep_settings', null);
  const parsed = settingsSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await setMeta('sleep_settings', settingsSchema.parse(settings));
}

export async function loadChild(): Promise<Child> {
  return getMeta<Child>('child', { name: 'Toddler', birth_at: null });
}

export async function saveChild(child: Child): Promise<void> {
  await setMeta('child', child);
}

// --- Who is logging --------------------------------------------------------------

export type Identity = {
  household_id: string;
  child_id: string;
  user_id: string;
};

/** Until sign-in, the app works against a household that exists only on this phone. */
export async function identity(): Promise<Identity> {
  let stored = await getMeta<Identity | null>('sleep_identity', null);
  if (!stored) {
    stored = {
      household_id: crypto.randomUUID(),
      child_id: crypto.randomUUID(),
      user_id: 'local'
    };
    await setMeta('sleep_identity', stored);
  }
  return stored;
}

// --- Sleeps ------------------------------------------------------------------------

export async function liveSleeps(): Promise<Sleep[]> {
  const rows = await db.sleeps.toArray();
  const start = (s: Sleep) => Date.parse(s.asleep_at ?? s.in_bed_at ?? s.updated_at);
  return rows.filter((s) => !s.deleted_at).sort((a, b) => start(b) - start(a));
}

export async function liveDays(): Promise<DayRow[]> {
  const rows = await db.days.toArray();
  return rows.filter((d) => !d.deleted_at);
}

export async function unsentCount(): Promise<number> {
  const [sleeps, days] = await Promise.all([
    db.sleeps.where('synced').equals(0).count(),
    db.days.where('synced').equals(0).count()
  ]);
  return sleeps + days;
}

function stamp(who: Identity) {
  return {
    household_id: who.household_id,
    child_id: who.child_id,
    logged_by: who.user_id,
    rev: 1,
    updated_at: new Date().toISOString(),
    deleted_at: null,
    schema_version: SCHEMA_VERSION,
    synced: 0 as const
  };
}

export async function createSleep(
  who: Identity,
  kind: SleepKind,
  fields: Partial<Pick<Sleep, 'in_bed_at' | 'asleep_at' | 'woke_at' | 'wakings' | 'place' | 'mood' | 'note'>>
): Promise<Sleep> {
  const sleep: Sleep = {
    id: crypto.randomUUID(),
    kind,
    in_bed_at: null,
    asleep_at: null,
    woke_at: null,
    wakings: [],
    place: null,
    mood: null,
    note: null,
    ...fields,
    ...stamp(who)
  };
  await db.sleeps.put(sleep);
  return sleep;
}

export async function updateSleep(id: string, changes: Partial<Sleep>): Promise<Sleep | undefined> {
  const current = await db.sleeps.get(id);
  if (!current) return undefined;
  const next: Sleep = {
    ...current,
    ...changes,
    rev: current.rev + 1,
    updated_at: new Date().toISOString(),
    synced: 0
  };
  await db.sleeps.put(next);
  return next;
}

/** Soft delete, so the delete reaches the other phone. */
export async function deleteSleep(id: string): Promise<void> {
  await updateSleep(id, { deleted_at: new Date().toISOString() });
}

// --- Per-date changes ---------------------------------------------------------------

export async function saveDay(
  who: Identity,
  date: DateKey,
  changes: Partial<Pick<DayRow, 'override' | 'off_tag' | 'no_nap' | 'note'>>
): Promise<DayRow> {
  const id = dayId(who.child_id, date);
  const current = await db.days.get(id);
  const next: DayRow = current
    ? {
        ...current,
        ...changes,
        deleted_at: null,
        rev: current.rev + 1,
        updated_at: new Date().toISOString(),
        synced: 0
      }
    : {
        id,
        date,
        override: {},
        off_tag: null,
        no_nap: false,
        note: null,
        ...changes,
        ...stamp(who)
      };
  await db.days.put(next);
  return next;
}

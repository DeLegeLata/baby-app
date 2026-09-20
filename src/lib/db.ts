// Local storage. Every write lands here first and shows on screen immediately;
// the outbox (synced = 0) uploads whenever the app can reach Supabase.
import Dexie, { type Table } from 'dexie';
import {
  DEFAULT_APP_SETTINGS,
  SCHEMA_VERSION,
  settingsSchema,
  type AppSettings,
  type Entry,
  type FeedMethod,
  type MilkType,
  type Side
} from './model';

export type Meta = { key: string; value: unknown };

class BabyDb extends Dexie {
  entries!: Table<Entry, string>;
  meta!: Table<Meta, string>;

  constructor() {
    super('baby-app');
    this.version(1).stores({
      entries: 'id, kind, started_at, synced, deleted_at, epoch',
      meta: 'key'
    });
  }
}

export const db = new BabyDb();

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export async function loadSettings(): Promise<AppSettings> {
  const stored = await getMeta<unknown>('settings', null);
  const parsed = settingsSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_APP_SETTINGS;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await setMeta('settings', settingsSchema.parse(settings));
}

export type Identity = {
  household_id: string;
  baby_id: string;
  user_id: string;
  epoch: number;
};

/** Until sign-in exists, the app works against a local household. */
export async function identity(): Promise<Identity> {
  let stored = await getMeta<Identity | null>('identity', null);
  if (!stored) {
    stored = {
      household_id: crypto.randomUUID(),
      baby_id: crypto.randomUUID(),
      user_id: 'local',
      epoch: 1
    };
    await setMeta('identity', stored);
  }
  return stored;
}

export async function entriesInEpoch(epoch: number): Promise<Entry[]> {
  const rows = await db.entries.where('epoch').equals(epoch).toArray();
  return rows
    .filter((e) => !e.deleted_at)
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

export async function unsentCount(): Promise<number> {
  return db.entries.where('synced').equals(0).count();
}

function blank(identity: Identity, kind: Entry['kind'], started: Date): Entry {
  const nowIso = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    household_id: identity.household_id,
    baby_id: identity.baby_id,
    kind,
    started_at: started.toISOString(),
    ended_at: null,
    logged_by: identity.user_id,
    rev: 1,
    updated_at: nowIso,
    deleted_at: null,
    schema_version: SCHEMA_VERSION,
    epoch: identity.epoch,
    feed_method: null,
    left_sec: null,
    right_sec: null,
    last_side: null,
    bottle_ml: null,
    milk_type: null,
    wet: null,
    dirty: null,
    stool_color: null,
    note: null,
    synced: 0
  };
}

export async function startFeed(
  who: Identity,
  method: FeedMethod,
  startedAt: Date = new Date()
): Promise<Entry> {
  const entry = blank(who, 'feed', startedAt);
  entry.feed_method = method;
  if (method === 'nursing') {
    entry.left_sec = 0;
    entry.right_sec = 0;
  }
  await db.entries.put(entry);
  return entry;
}

export async function updateEntry(id: string, changes: Partial<Entry>): Promise<Entry | undefined> {
  const current = await db.entries.get(id);
  if (!current) return undefined;
  const next: Entry = {
    ...current,
    ...changes,
    rev: current.rev + 1,
    updated_at: new Date().toISOString(),
    synced: 0
  };
  await db.entries.put(next);
  return next;
}

export async function stopFeed(id: string, sides?: { left_sec: number; right_sec: number; last_side: Side | null }) {
  return updateEntry(id, { ended_at: new Date().toISOString(), ...(sides ?? {}) });
}

export async function logBottle(
  who: Identity,
  ml: number,
  milk: MilkType,
  startedAt: Date = new Date()
): Promise<Entry> {
  const entry = blank(who, 'feed', startedAt);
  entry.feed_method = 'bottle';
  entry.bottle_ml = ml;
  entry.milk_type = milk;
  entry.ended_at = startedAt.toISOString();
  await db.entries.put(entry);
  return entry;
}

export async function logDiaper(
  who: Identity,
  opts: { wet: boolean; dirty: boolean; stool_color?: number | null; note?: string | null },
  startedAt: Date = new Date()
): Promise<Entry> {
  const entry = blank(who, 'diaper', startedAt);
  entry.wet = opts.wet;
  entry.dirty = opts.dirty;
  entry.stool_color = opts.stool_color ?? null;
  entry.note = opts.note ?? null;
  entry.ended_at = startedAt.toISOString();
  await db.entries.put(entry);
  return entry;
}

/** Soft delete, so the delete reaches the other phone. */
export async function deleteEntry(id: string): Promise<void> {
  await updateEntry(id, { deleted_at: new Date().toISOString() });
}

/** Practice cutover: bump the epoch and drop everything from the old one. */
export async function bumpEpoch(): Promise<Identity> {
  const who = await identity();
  const next: Identity = { ...who, epoch: who.epoch + 1 };
  await db.entries.where('epoch').equals(who.epoch).delete();
  await setMeta('identity', next);
  return next;
}

export type Counts = { feeds: number; wet: number; dirty: number };

export function countsSince(entries: Entry[], sinceMs: number): Counts {
  const counts: Counts = { feeds: 0, wet: 0, dirty: 0 };
  for (const entry of entries) {
    if (entry.deleted_at || Date.parse(entry.started_at) < sinceMs) continue;
    if (entry.kind === 'feed') counts.feeds += 1;
    if (entry.kind === 'diaper') {
      if (entry.wet) counts.wet += 1;
      if (entry.dirty) counts.dirty += 1;
    }
  }
  return counts;
}

// The outbox, the pull and realtime, for the sleeps and the per-date changes.
// New sleeps never conflict because the phone makes their ids; an edit carries
// its rev, and a stale edit is handed back to the screen as a conflict. A date
// has one fixed id, so both phones address the same row.
import type { Table } from 'dexie';
import { db, getMeta, setMeta } from './db';
import {
  BATH_COLUMNS,
  DAY_COLUMNS,
  SLEEP_COLUMNS,
  settingsSchema,
  toRow,
  type AppSettings,
  type Bath,
  type Child,
  type DayRow,
  type Sleep
} from './model';
import { supabase } from './supabase';

export type TableName = 'sleeps' | 'days' | 'baths';
type Row = Sleep | DayRow | Bath;

const COLUMNS: Record<TableName, readonly string[]> = {
  sleeps: SLEEP_COLUMNS,
  days: DAY_COLUMNS,
  baths: BATH_COLUMNS
};
const TABLES: TableName[] = ['sleeps', 'days', 'baths'];

const local = (table: TableName) => db[table] as unknown as Table<Row, string>;

export type Conflict = { table: TableName; local: Row; remote: Row };

const lastPullKey = (table: TableName) => `last_pull_${table}`;

function fromRow(row: Record<string, unknown>): Row {
  return { ...row, synced: 1 } as Row;
}

/** Apply a row from the server unless the phone holds a newer revision. */
async function applyRow(table: TableName, row: Record<string, unknown>): Promise<void> {
  const mine = await local(table).get(row.id as string);
  if (mine && mine.rev > (row.rev as number)) return; // our own newer edit wins until it uploads
  if (mine && mine.synced === 0 && mine.rev === row.rev) return;
  await local(table).put(fromRow(row));
}

export async function pushOutbox(): Promise<Conflict[]> {
  if (!supabase) return [];
  const conflicts: Conflict[] = [];

  for (const table of TABLES) {
    const pending = await local(table).where('synced').equals(0).toArray();
    for (const record of pending) {
      const row = toRow(record as unknown as Record<string, unknown>, COLUMNS[table]);

      if (record.rev === 1) {
        const { error } = await supabase.from(table).insert(row);
        if (!error) {
          await local(table).put({ ...record, synced: 1 });
          continue;
        }
        // 23505 is a duplicate id: the row is already up there, so fall through to the edit path.
        if (error.code !== '23505') throw error;
      }

      const { data, error } = await supabase
        .from(table)
        .update(row)
        .eq('id', record.id)
        .lt('rev', record.rev)
        .select();
      if (error) throw error;

      if (data && data.length > 0) {
        await local(table).put({ ...record, synced: 1 });
        continue;
      }

      // Nothing updated: either the row is missing, or the other phone is ahead.
      const { data: remote } = await supabase.from(table).select('*').eq('id', record.id).maybeSingle();
      if (!remote) {
        const { error: insertError } = await supabase.from(table).insert(row);
        if (insertError) throw insertError;
        await local(table).put({ ...record, synced: 1 });
      } else if (record.rev === 1 && table === 'days') {
        // Both phones made the same date's row: keep theirs, with what this phone set laid on top.
        const theirs = remote as DayRow;
        const merged = { ...theirs, ...pickDay(theirs, record as DayRow), rev: theirs.rev + 1, synced: 0 as const };
        await local(table).put(merged);
        await pushOne(table, merged);
      } else {
        conflicts.push({ table, local: record, remote: fromRow(remote) });
      }
    }
  }
  return conflicts;
}

/** Only the fields this phone actually set; the rest stay as the other phone left them. */
function pickDay(theirs: DayRow, mine: DayRow) {
  return {
    override: { ...theirs.override, ...mine.override },
    off_tag: mine.off_tag ?? theirs.off_tag,
    no_nap: mine.no_nap || theirs.no_nap,
    note: mine.note ?? theirs.note,
    updated_at: new Date().toISOString()
  };
}

async function pushOne(table: TableName, record: Row) {
  if (!supabase) return;
  const row = toRow(record as unknown as Record<string, unknown>, COLUMNS[table]);
  const { data, error } = await supabase.from(table).update(row).eq('id', record.id).lt('rev', record.rev).select();
  if (error) throw error;
  if (data && data.length) await local(table).put({ ...record, synced: 1 });
}

export async function pullChanges(householdId: string): Promise<number> {
  if (!supabase) return 0;
  let count = 0;
  for (const table of TABLES) {
    const since = await getMeta<string>(lastPullKey(table), '1970-01-01T00:00:00.000Z');
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('household_id', householdId)
      .gt('updated_at', since)
      .order('updated_at', { ascending: true });
    if (error) throw error;
    for (const row of data ?? []) await applyRow(table, row);
    if (data && data.length) await setMeta(lastPullKey(table), data[data.length - 1].updated_at);
    count += data?.length ?? 0;
  }
  return count;
}

/** Live updates while both apps are open. */
export function subscribeRealtime(householdId: string, onChange: () => void) {
  const client = supabase;
  if (!client) return () => {};
  let channel = client.channel(`sleep:${householdId}`);
  for (const table of TABLES) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` },
      async (payload) => {
        const row = payload.new as Record<string, unknown>;
        if (row?.id) {
          await applyRow(table, row);
          onChange();
        }
      }
    );
  }
  channel.subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

/** Conflict resolution: keep this phone's version, or the other phone's. */
export async function resolveConflict(conflict: Conflict, keep: 'local' | 'remote'): Promise<void> {
  if (keep === 'remote') {
    await local(conflict.table).put({ ...conflict.remote, synced: 1 });
    return;
  }
  const winner: Row = { ...conflict.local, rev: conflict.remote.rev + 1, synced: 0 };
  await local(conflict.table).put(winner);
  await pushOutbox();
}

// --- Settings, shared through the household row -------------------------------------

export async function pullSettings(householdId: string): Promise<AppSettings | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('households').select('settings').eq('id', householdId).maybeSingle();
  if (error) throw error;
  const parsed = settingsSchema.safeParse((data?.settings as Record<string, unknown> | null)?.sleep);
  return parsed.success ? parsed.data : null;
}

export async function pushSettings(householdId: string, settings: AppSettings): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase.from('households').select('settings').eq('id', householdId).maybeSingle();
  if (error) throw error;
  const merged = { ...((data?.settings as Record<string, unknown>) ?? {}), sleep: settings };
  const { error: updateError } = await supabase
    .from('households')
    .update({ settings: merged, time_zone: settings.time_zone })
    .eq('id', householdId);
  if (updateError) throw updateError;
}

// --- The child -------------------------------------------------------------------------

export type RemoteChild = Child & { id: string };

/** The toddler's row; the newborn's row (role 'baby') is left as it was. */
export async function fetchChild(householdId: string): Promise<RemoteChild | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('babies')
    .select('id,name,birth_at')
    .eq('household_id', householdId)
    .eq('role', 'toddler')
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id as string, name: data.name as string, birth_at: data.birth_at as string | null } : null;
}

export async function pushChild(childId: string, child: Child): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('babies').update({ name: child.name, birth_at: child.birth_at }).eq('id', childId);
  if (error) throw error;
}

// --- Presence ----------------------------------------------------------------------------

/** Say hello so the other phone can show when this one last synced. */
export async function touchMember(householdId: string, userId: string): Promise<void> {
  if (!supabase) return;
  await supabase
    .from('members')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('household_id', householdId)
    .eq('user_id', userId);
}

export async function partnerLastSeen(householdId: string, userId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('members')
    .select('user_id,last_seen_at')
    .eq('household_id', householdId)
    .neq('user_id', userId);
  const times = (data ?? []).map((m) => m.last_seen_at).filter(Boolean) as string[];
  return times.sort().pop() ?? null;
}

/**
 * What went wrong, in words. Supabase hands back plain objects as often as
 * Error instances, a missing table or column means the SQL step was missed,
 * and a request that failed or ran out of time means no connection.
 */
export function describeError(error: unknown): string {
  const e = error as { message?: unknown; code?: unknown } | null;
  const message = typeof e?.message === 'string' ? e.message : String(error);
  const code = typeof e?.code === 'string' ? e.code : '';
  const missing =
    ['PGRST204', 'PGRST205', '42P01', '42703'].includes(code) || /schema cache|does not exist/i.test(message);
  const unreachable = /failed to fetch|load failed|networkerror|did not answer|aborted/i.test(message);
  if (unreachable) return `Could not reach Supabase. Check this phone's connection and try again. (${message})`;
  return missing
    ? `Supabase needs the latest supabase/toddler.sql: copy it from GitHub and run it in the SQL editor (SETUP.md, step 4b). (${message})`
    : message;
}


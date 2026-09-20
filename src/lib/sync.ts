// The outbox, the pull and realtime. New entries never conflict because the
// phone makes their ids; an edit carries its rev, and a stale edit is handed
// back to the screen as a conflict.
import { db, getMeta, setMeta } from './db';
import { toRow, type Entry, type EntryRow } from './model';
import { supabase } from './supabase';

export type Conflict = { local: Entry; remote: EntryRow };

const LAST_PULL = 'last_pull_at';

function fromRow(row: EntryRow): Entry {
  return { ...row, synced: 1 } as Entry;
}

/** Apply a row from the server unless the phone holds a newer revision. */
async function applyRow(row: EntryRow): Promise<void> {
  const local = await db.entries.get(row.id);
  if (local && local.rev > row.rev) return; // our own newer edit wins until it uploads
  if (local && local.synced === 0 && local.rev === row.rev) return;
  await db.entries.put(fromRow(row));
}

export async function pushOutbox(): Promise<Conflict[]> {
  if (!supabase) return [];
  const pending = await db.entries.where('synced').equals(0).toArray();
  const conflicts: Conflict[] = [];

  for (const entry of pending) {
    const row = toRow(entry);

    if (entry.rev === 1) {
      const { error } = await supabase.from('entries').insert(row);
      if (!error) {
        await db.entries.put({ ...entry, synced: 1 });
        continue;
      }
      // 23505 is a duplicate id: the row is already up there, so fall through to the edit path.
      if (error.code !== '23505') throw error;
    }

    const { data, error } = await supabase
      .from('entries')
      .update(row)
      .eq('id', entry.id)
      .lt('rev', entry.rev)
      .select();
    if (error) throw error;

    if (data && data.length > 0) {
      await db.entries.put({ ...entry, synced: 1 });
      continue;
    }

    // Nothing updated: either the row is missing, or the other phone is ahead.
    const { data: remote } = await supabase.from('entries').select('*').eq('id', entry.id).maybeSingle();
    if (!remote) {
      const { error: insertError } = await supabase.from('entries').insert(row);
      if (insertError) throw insertError;
      await db.entries.put({ ...entry, synced: 1 });
    } else {
      conflicts.push({ local: entry, remote: remote as EntryRow });
    }
  }
  return conflicts;
}

export async function pullChanges(householdId: string): Promise<number> {
  if (!supabase) return 0;
  const since = await getMeta<string>(LAST_PULL, '1970-01-01T00:00:00.000Z');
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('household_id', householdId)
    .gt('updated_at', since)
    .order('updated_at', { ascending: true });
  if (error) throw error;

  for (const row of (data ?? []) as EntryRow[]) await applyRow(row);
  if (data && data.length) await setMeta(LAST_PULL, data[data.length - 1].updated_at);
  return data?.length ?? 0;
}

/** Live updates while both apps are open. */
export function subscribeRealtime(householdId: string, onChange: () => void) {
  const client = supabase;
  if (!client) return () => {};
  const channel = client
    .channel(`entries:${householdId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'entries', filter: `household_id=eq.${householdId}` },
      async (payload) => {
        const row = payload.new as EntryRow;
        if (row?.id) {
          await applyRow(row);
          onChange();
        }
      }
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}

/** Conflict resolution: keep this phone's version, or the other phone's. */
export async function resolveConflict(conflict: Conflict, keep: 'local' | 'remote'): Promise<void> {
  if (keep === 'remote') {
    await db.entries.put(fromRow(conflict.remote));
    return;
  }
  const winner: Entry = { ...conflict.local, rev: conflict.remote.rev + 1, synced: 0 };
  await db.entries.put(winner);
  await pushOutbox();
}

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

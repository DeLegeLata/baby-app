// One reactive store over the local database. Screens read it; actions write
// through db.ts and refresh it.
import {
  bumpEpoch,
  countsSince,
  db,
  deleteEntry,
  entriesInEpoch,
  identity,
  loadSettings,
  logBottle,
  logDiaper,
  saveSettings,
  setMeta,
  startFeed,
  stopFeed,
  unsentCount,
  updateEntry,
  getMeta,
  type Counts,
  type Identity
} from './db';
import {
  DEFAULT_APP_SETTINGS,
  expectedFor,
  ruleSettings,
  type AppSettings,
  type Entry,
  type FeedMethod,
  type MilkType,
  type Side
} from './model';
import { dayOfLife, timerState, type Feed, type TimerState } from './rule';
import { configured, supabase } from './supabase';
import {
  partnerLastSeen,
  pullChanges,
  pushOutbox,
  resolveConflict,
  subscribeRealtime,
  touchMember,
  type Conflict
} from './sync';

export type Baby = { name: string; birth_at: string | null };

const DAY = 86_400_000;

class AppState {
  entries = $state<Entry[]>([]);
  settings = $state<AppSettings>(DEFAULT_APP_SETTINGS);
  baby = $state<Baby>({ name: 'Baby', birth_at: null });
  who = $state<Identity | null>(null);
  now = $state(Date.now());
  unsent = $state(0);
  ready = $state(false);

  // sync
  signedIn = $state(false);
  syncConfigured = configured;
  syncNeedsSignIn = $derived(configured && !this.signedIn);
  syncing = $state(false);
  lastSyncAt = $state<number | null>(null);
  syncError = $state<string | null>(null);
  conflicts = $state<Conflict[]>([]);
  partnerSeenAt = $state<string | null>(null);
  private unsubscribeRealtime: (() => void) | null = null;

  feeds = $derived(
    this.entries
      .filter((e) => e.kind === 'feed')
      .map((e): Feed => ({ id: e.id, started_at: e.started_at, ended_at: e.ended_at, deleted_at: e.deleted_at }))
  );

  timer = $derived<TimerState>(timerState(this.feeds, ruleSettings(this.settings), this.now));

  /** The feed still running, if any: Start offers to join it. */
  runningFeed = $derived<Entry | null>(
    this.entries.find((e) => e.kind === 'feed' && !e.ended_at && !e.deleted_at) ?? null
  );

  counts = $derived<Counts>(countsSince(this.entries, this.now - DAY));

  dayOfLife = $derived<number | null>(
    this.baby.birth_at ? dayOfLife(this.baby.birth_at, this.now, this.settings.time_zone) : null
  );

  expected = $derived(this.dayOfLife === null ? null : expectedFor(this.settings, this.dayOfLife));

  async init() {
    this.who = await identity();
    this.settings = await loadSettings();
    this.baby = await getMeta<Baby>('baby', { name: 'Baby', birth_at: null });
    await this.refresh();
    this.ready = true;
    setInterval(() => (this.now = Date.now()), 1000);

    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    await this.onSession(Boolean(data.session));
    supabase.auth.onAuthStateChange((_event, session) => void this.onSession(Boolean(session)));

    // The outbox goes up whenever the app can send: on open, back online, and
    // when the phone shows or hides the app again.
    const trigger = () => void this.sync();
    addEventListener('online', trigger);
    addEventListener('focus', trigger);
    addEventListener('visibilitychange', trigger);
    addEventListener('pagehide', trigger);
  }

  private async onSession(signedIn: boolean) {
    this.signedIn = signedIn;
    if (!signedIn || !supabase) {
      this.unsubscribeRealtime?.();
      this.unsubscribeRealtime = null;
      return;
    }
    await this.adoptHousehold();
    await this.sync();

    const who = this.who;
    if (who) {
      this.unsubscribeRealtime?.();
      this.unsubscribeRealtime = subscribeRealtime(who.household_id, () => void this.refresh());
    }
  }

  /**
   * After sign-in the real household and baby ids replace the local-only ones,
   * and anything logged before sign-in is re-pointed and queued for upload.
   */
  private async adoptHousehold() {
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;

    const { data: membership } = await supabase
      .from('members')
      .select('household_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (!membership) {
      this.syncError = 'This account is not in a household yet. Add the member row in Supabase.';
      return;
    }

    const householdId = membership.household_id as string;
    const { data: household } = await supabase
      .from('households')
      .select('data_epoch')
      .eq('id', householdId)
      .maybeSingle();
    const { data: babies } = await supabase
      .from('babies')
      .select('id,name,birth_at')
      .eq('household_id', householdId)
      .order('name');

    const baby = babies?.[0];
    if (!baby) {
      this.syncError = 'No baby in this household yet. Add one in Supabase.';
      return;
    }

    const previous = this.who ?? (await identity());
    const next: Identity = {
      household_id: householdId,
      baby_id: baby.id as string,
      user_id: userId,
      epoch: (household?.data_epoch as number) ?? previous.epoch
    };

    if (
      previous.household_id !== next.household_id ||
      previous.baby_id !== next.baby_id ||
      previous.user_id !== next.user_id
    ) {
      const mine = await db.entries.toArray();
      await db.entries.bulkPut(
        mine.map((entry) => ({
          ...entry,
          household_id: next.household_id,
          baby_id: next.baby_id,
          logged_by: entry.logged_by === 'local' ? next.user_id : entry.logged_by,
          epoch: next.epoch,
          synced: 0 as const
        }))
      );
    }

    this.who = next;
    await setMeta('identity', next);
    await this.saveBaby({
      name: (baby.name as string) ?? this.baby.name,
      birth_at: (baby.birth_at as string | null) ?? this.baby.birth_at
    });
    this.syncError = null;
  }

  /** Push the outbox, pull what the other phone wrote, then refresh. */
  async sync() {
    if (!supabase || !this.signedIn || this.syncing) return;
    const who = this.who;
    if (!who) return;

    this.syncing = true;
    try {
      const conflicts = await pushOutbox();
      if (conflicts.length) this.conflicts = conflicts;
      await pullChanges(who.household_id);
      await touchMember(who.household_id, who.user_id);
      this.partnerSeenAt = await partnerLastSeen(who.household_id, who.user_id);
      this.lastSyncAt = Date.now();
      this.syncError = null;
    } catch (error) {
      this.syncError = error instanceof Error ? error.message : String(error);
    } finally {
      this.syncing = false;
      await this.refresh();
    }
  }

  async resolve(conflict: Conflict, keep: 'local' | 'remote') {
    await resolveConflict(conflict, keep);
    this.conflicts = this.conflicts.filter((c) => c.local.id !== conflict.local.id);
    await this.refresh();
  }

  async refresh() {
    const who = this.who ?? (await identity());
    this.entries = await entriesInEpoch(who.epoch);
    this.unsent = await unsentCount();
  }

  private async act<T>(run: (who: Identity) => Promise<T>): Promise<T> {
    const who = this.who ?? (await identity());
    const result = await run(who);
    await this.refresh();
    void this.sync();
    return result;
  }

  startFeed(method: FeedMethod, minutesAgo = 0) {
    const startedAt = new Date(Date.now() - minutesAgo * 60_000);
    return this.act((who) => startFeed(who, method, startedAt));
  }

  stopFeed(id: string, sides?: { left_sec: number; right_sec: number; last_side: Side | null }) {
    return this.act(() => stopFeed(id, sides));
  }

  logBottle(ml: number, milk: MilkType, minutesAgo = 0) {
    const startedAt = new Date(Date.now() - minutesAgo * 60_000);
    return this.act((who) => logBottle(who, ml, milk, startedAt));
  }

  logDiaper(opts: { wet: boolean; dirty: boolean; stool_color?: number | null }, minutesAgo = 0) {
    const startedAt = new Date(Date.now() - minutesAgo * 60_000);
    return this.act((who) => logDiaper(who, opts, startedAt));
  }

  editEntry(id: string, changes: Partial<Entry>) {
    return this.act(() => updateEntry(id, changes));
  }

  removeEntry(id: string) {
    return this.act(() => deleteEntry(id));
  }

  async saveSettings(next: AppSettings) {
    await saveSettings(next);
    this.settings = next;
  }

  async saveBaby(next: Baby) {
    await setMeta('baby', next);
    this.baby = next;
  }

  async wipePracticeData() {
    this.who = await bumpEpoch();
    await this.refresh();
  }

  /** Test A3: every entry, including deleted ones, for the CSV export. */
  allRows() {
    return db.entries.toArray();
  }
}

export const app = new AppState();

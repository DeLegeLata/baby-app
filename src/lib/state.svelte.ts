// One reactive store over the local database. Screens read it; actions write
// through db.ts and refresh it. The engine runs on the minute, not the second.
import {
  createBath,
  createSleep,
  db,
  deleteBath,
  deleteSleep,
  getMeta,
  identity,
  liveBaths,
  liveDays,
  liveSleeps,
  loadChild,
  loadSettings,
  saveChild,
  saveDay,
  saveSettings,
  setMeta,
  unsentCount,
  updateBath,
  updateSleep,
  type Identity
} from './db';
import {
  History,
  bathStatus,
  dayOf,
  daycareEntry,
  guessKind,
  learn,
  phaseOf,
  planBedtime,
  planWake,
  plannedReminders,
  type BathStatus,
  type BedtimePlan,
  type DaycareEntry,
  type EngineInput,
  type Phase,
  type WakePlan
} from './engine';
import {
  DEFAULT_SETTINGS,
  dayId,
  type Activity,
  type AppSettings,
  type Bath,
  type Child,
  type DayRow,
  type Mood,
  type Place,
  type Sleep,
  type SleepKind
} from './model';
import { pushStatus, writeReminders, type PushStatus } from './reminders';
import { configured, supabase } from './supabase';
import {
  describeError,
  fetchChild,
  partnerLastSeen,
  pullChanges,
  pullSettings,
  pushChild,
  pushOutbox,
  pushSettings,
  resolveConflict,
  subscribeRealtime,
  touchMember,
  type Conflict
} from './sync';
import { dateKey, isoWeekday, minutesOf, parseClock, type DateKey } from './time';

/** Screen state is proxied, and IndexedDB cannot store a proxy. */
const plain = <T>(value: T): T => $state.snapshot(value) as T;

class AppState {
  sleeps = $state<Sleep[]>([]);
  days = $state<DayRow[]>([]);
  baths = $state<Bath[]>([]);
  settings = $state<AppSettings>(DEFAULT_SETTINGS);
  child = $state<Child>({ name: 'Toddler', birth_at: null });
  who = $state<Identity | null>(null);
  now = $state(Date.now());
  unsent = $state(0);
  ready = $state(false);
  push = $state<PushStatus>('unconfigured');

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

  /** the clock the engine sees: it only moves once a minute */
  minute = $derived(Math.floor(this.now / 60_000) * 60_000);

  input = $derived<EngineInput>({
    sleeps: this.sleeps,
    days: this.days,
    baths: this.baths,
    settings: this.settings,
    birth_at: this.child.birth_at,
    now: this.minute
  });

  history = $derived(new History(this.input));
  current = $derived<Sleep | null>(
    (() => {
      const open = this.history.current();
      return open ? (this.sleeps.find((s) => s.id === open.id) ?? null) : null;
    })()
  );
  phase = $derived<Phase>(phaseOf(this.current));
  today = $derived<DateKey>(this.history.today());
  todaySchedule = $derived(this.history.schedule(this.today));
  lastWoke = $derived(this.history.lastWoke());

  bedtime = $derived<BedtimePlan | null>(
    this.current?.kind === 'night' ? null : planBedtime(this.input, this.today)
  );
  /** how long he usually takes to fall asleep, as learned */
  settle = $derived(Math.round(learn(this.history, this.today).settle));

  /** the last bath, and whether one is due by the interval in Settings */
  bath = $derived<BathStatus>(bathStatus(this.input, this.today));

  wake = $derived<WakePlan | null>(
    this.current?.kind === 'night' ? planWake(this.input, this.current) : null
  );

  /** Dim red from the routine until morning, and whenever a night is running. */
  nightLook = $derived(
    this.settings.night_look === 'auto' &&
      (this.current?.kind === 'night' ||
        (this.bedtime !== null && this.minute >= this.bedtime.routineAt) ||
        minutesOf(dateKey(this.minute, this.settings.time_zone), this.minute, this.settings.time_zone) < 5 * 60)
  );

  async init() {
    this.who = await identity();
    this.settings = await loadSettings();
    this.child = await loadChild();
    await this.refresh();
    this.ready = true;
    setInterval(() => (this.now = Date.now()), 10_000);
    setInterval(() => void this.planReminders(), 60_000);
    void this.refreshPush();

    // Coming back to the app: the clock catches up at once, and the outbox goes
    // up whenever the app can send (on open, back online, shown or hidden).
    const trigger = () => {
      this.now = Date.now();
      void this.sync();
    };
    addEventListener('online', trigger);
    addEventListener('focus', trigger);
    addEventListener('visibilitychange', trigger);
    addEventListener('pagehide', trigger);

    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    await this.onSession(Boolean(data.session));
    supabase.auth.onAuthStateChange((_event, session) => void this.onSession(Boolean(session)));
  }

  async refreshPush() {
    try {
      this.push = await pushStatus();
    } catch {
      this.push = 'unsupported';
    }
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
    if (who && who.user_id !== 'local') {
      this.unsubscribeRealtime?.();
      this.unsubscribeRealtime = subscribeRealtime(who.household_id, () => void this.refresh());
    }
  }

  /**
   * After sign-in the real household and child ids replace the local-only ones,
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

    let remote;
    try {
      remote = await fetchChild(householdId);
    } catch (error) {
      this.syncError = describeError(error);
      return;
    }
    if (!remote) {
      this.syncError = 'No toddler in this household yet. Run supabase/toddler.sql in the Supabase SQL editor (SETUP.md, step 4b).';
      return;
    }

    const previous = this.who ?? (await identity());
    const next: Identity = { household_id: householdId, child_id: remote.id, user_id: userId };

    if (
      previous.household_id !== next.household_id ||
      previous.child_id !== next.child_id ||
      previous.user_id !== next.user_id
    ) {
      // Rows already up there for this household are left alone; only rows
      // logged before sign-in (or for another household) are re-pointed and queued.
      const stays = (row: { household_id: string; child_id: string; logged_by: string }) =>
        row.household_id === next.household_id && row.child_id === next.child_id && row.logged_by !== 'local';
      const repoint = <T extends { household_id: string; child_id: string; logged_by: string }>(row: T): T => ({
        ...row,
        household_id: next.household_id,
        child_id: next.child_id,
        logged_by: row.logged_by === 'local' ? next.user_id : row.logged_by,
        synced: 0 as const
      });
      const sleeps = (await db.sleeps.toArray()).filter((s) => !stays(s));
      await db.sleeps.bulkPut(sleeps.map(repoint));
      // A date's id carries the child id, so those rows are re-keyed.
      const days = (await db.days.toArray()).filter((d) => !stays(d));
      await db.days.bulkDelete(days.map((d) => d.id));
      await db.days.bulkPut(days.map((d) => ({ ...repoint(d), id: dayId(next.child_id, d.date) })));
      const baths = (await db.baths.toArray()).filter((b) => !stays(b));
      await db.baths.bulkPut(baths.map(repoint));
    }

    this.who = next;
    await setMeta('sleep_identity', next);

    const childDirty = await getMeta('child_dirty', false);
    if (childDirty) {
      await pushChild(remote.id, this.child);
      await setMeta('child_dirty', false);
    } else {
      this.child = { name: remote.name, birth_at: remote.birth_at };
      await saveChild(this.child);
    }
    this.syncError = null;
  }

  /** Push the outbox, pull what the other phone wrote, settle the settings, then refresh. */
  async sync() {
    if (!supabase || !this.signedIn || this.syncing) return;
    const who = this.who;
    if (!who || who.user_id === 'local') return;

    this.syncing = true;
    try {
      const conflicts = await pushOutbox();
      if (conflicts.length) this.conflicts = conflicts;
      await pullChanges(who.household_id);
      await this.syncSettings(who.household_id);
      await touchMember(who.household_id, who.user_id);
      this.partnerSeenAt = await partnerLastSeen(who.household_id, who.user_id);
      this.lastSyncAt = Date.now();
      this.syncError = null;
    } catch (error) {
      this.syncError = describeError(error);
    } finally {
      this.syncing = false;
      await this.refresh();
    }
  }

  /** The newer copy wins; the first phone to sync seeds the household. */
  private async syncSettings(householdId: string) {
    const remote = await pullSettings(householdId);
    const dirty = await getMeta('settings_dirty', false);
    const mine = Date.parse(this.settings.updated_at);
    if (!remote || (dirty && mine >= Date.parse(remote.updated_at))) {
      await pushSettings(householdId, this.settings);
      await setMeta('settings_dirty', false);
    } else if (Date.parse(remote.updated_at) > mine) {
      this.settings = remote;
      await saveSettings(remote);
      await setMeta('settings_dirty', false);
    }
  }

  async resolve(conflict: Conflict, keep: 'local' | 'remote') {
    await resolveConflict(conflict, keep);
    this.conflicts = this.conflicts.filter((c) => c.local.id !== conflict.local.id);
    await this.refresh();
  }

  async refresh() {
    this.sleeps = await liveSleeps();
    this.days = await liveDays();
    this.baths = await liveBaths();
    this.unsent = await unsentCount();
    this.now = Date.now();
    void this.planReminders();
  }

  /** Tell the reminder server what is due, whenever the picture changes. */
  async planReminders() {
    const who = this.who;
    if (!supabase || !this.signedIn || !who || who.user_id === 'local') return;
    try {
      await writeReminders(who.household_id, plannedReminders(this.input, this.child.name));
    } catch {
      // The next refresh tries again; logging must never wait on reminders.
    }
  }

  private async act<T>(run: (who: Identity) => Promise<T>): Promise<T> {
    const who = this.who ?? (await identity());
    const result = await run(who);
    await this.refresh();
    void this.sync();
    return result;
  }

  // --- Live logging -----------------------------------------------------------

  /** A bath logged in the last two hours was part of this bedtime, so the sleep notes it. */
  private bathJustNow(): Activity[] {
    const now = Date.now();
    return this.baths.some((b) => Date.parse(b.at) <= now && now - Date.parse(b.at) <= 2 * 3_600_000) ? ['bath'] : [];
  }

  /** Into bed now. The kind follows the time of day and can be changed on the card. */
  putToBed() {
    const kind = guessKind(this.input, 'bed', Date.now());
    const activities = this.bathJustNow();
    return this.act((who) =>
      createSleep(who, kind, { in_bed_at: new Date().toISOString(), place: 'bed', activities })
    );
  }

  /** Asleep now: either the sleep he is in bed for, or a new one (a catnap in the car). */
  fellAsleep(kind?: SleepKind, place?: Place) {
    const now = new Date().toISOString();
    const cur = this.current;
    if (cur && !cur.asleep_at) {
      return this.act(() => updateSleep(cur.id, { asleep_at: now, ...(kind ? { kind } : {}) }));
    }
    const chosen = kind ?? guessKind(this.input, 'asleep', Date.now());
    const activities = chosen === 'catnap' ? [] : this.bathJustNow();
    return this.act((who) => createSleep(who, chosen, { asleep_at: now, place: place ?? null, activities }));
  }

  /** He never fell asleep: drop the in-bed record. */
  notSleeping() {
    const cur = this.current;
    if (!cur) return;
    return this.act(() => deleteSleep(cur.id));
  }

  /** End a nap, or start a night waking. */
  wokeUp() {
    const cur = this.current;
    if (!cur) return;
    const now = new Date().toISOString();
    if (cur.kind !== 'night') return this.act(() => updateSleep(cur.id, { woke_at: now }));
    const wakings = plain(cur.wakings);
    return this.act(() => updateSleep(cur.id, { wakings: [...wakings, { start: now, end: null }] }));
  }

  backAsleep() {
    const cur = this.current;
    if (!cur) return;
    const now = new Date().toISOString();
    const wakings = plain(cur.wakings).map((w) => (w.end ? w : { ...w, end: now }));
    return this.act(() => updateSleep(cur.id, { wakings }));
  }

  /** The night is over. If he was already awake, the night ended when that waking began. */
  upForTheDay() {
    const cur = this.current;
    if (!cur) return;
    const wakings = plain(cur.wakings);
    const open = wakings.find((w) => !w.end);
    const woke = open ? open.start : new Date().toISOString();
    return this.act(() => updateSleep(cur.id, { woke_at: woke, wakings: wakings.filter((w) => w !== open) }));
  }

  setKind(id: string, kind: SleepKind) {
    return this.act(() => updateSleep(id, { kind }));
  }

  setMood(id: string, mood: Mood | null) {
    return this.act(() => updateSleep(id, { mood }));
  }

  /** What he did before this sleep. */
  setActivities(id: string, activities: Activity[]) {
    const list = plain(activities);
    return this.act(() => updateSleep(id, { activities: list }));
  }

  // --- Baths ----------------------------------------------------------------------

  logBath(at: string = new Date().toISOString(), note: string | null = null) {
    return this.act((who) => createBath(who, at, note));
  }

  saveBath(id: string, at: string, note: string | null) {
    return this.act(() => updateBath(id, { at, note }));
  }

  removeBath(id: string) {
    return this.act(() => deleteBath(id));
  }

  // --- Editing ------------------------------------------------------------------

  saveSleep(id: string | null, kind: SleepKind, draft: Partial<Sleep>) {
    const fields = plain(draft);
    if (id) return this.act(() => updateSleep(id, { kind, ...fields }));
    return this.act((who) => createSleep(who, kind, fields));
  }

  removeSleep(id: string) {
    return this.act(() => deleteSleep(id));
  }

  saveDay(date: DateKey, draft: Partial<Pick<DayRow, 'override' | 'off_tag' | 'no_nap' | 'note'>>) {
    const changes = plain(draft);
    return this.act((who) => saveDay(who, date, changes));
  }

  dayRow(date: DateKey): DayRow | null {
    return this.days.find((d) => d.date === date) ?? null;
  }

  // --- The daycare card ----------------------------------------------------------

  /** The nap he had at daycare on a date: the nap marked daycare, else the first nap. */
  daycareNap(date: DateKey): Sleep | null {
    const naps = this.sleepsOn(date).filter((s) => s.kind === 'nap');
    return naps.find((s) => s.place === 'daycare') ?? naps[0] ?? null;
  }

  /**
   * Nap times from the Daycare card ('HH:MM'). Still to come, they become the
   * day's planned window; already over, they become the nap itself.
   */
  async setDaycareNap(date: DateKey, from: string, to: string): Promise<DaycareEntry> {
    const entry = daycareEntry(date, parseClock(from), parseClock(to), Date.now(), this.settings.time_zone);
    if (entry.kind === 'error') return entry;
    if (entry.kind === 'plan') {
      const override = { ...plain(this.dayRow(date)?.override ?? {}), nap_start: from, nap_end: to };
      await this.saveDay(date, { override, no_nap: false });
      return entry;
    }
    const existing = this.daycareNap(date);
    await this.saveSleep(existing?.id ?? null, 'nap', {
      asleep_at: new Date(entry.startAt).toISOString(),
      woke_at: new Date(entry.endAt).toISOString(),
      place: existing?.place ?? 'daycare'
    });
    if (this.dayRow(date)?.no_nap) await this.saveDay(date, { no_nap: false });
    return entry;
  }

  /** Back to the usual nap window for a date. */
  async usualNapWindow(date: DateKey) {
    const { nap_start: _start, nap_end: _end, ...rest } = plain(this.dayRow(date)?.override ?? {});
    await this.saveDay(date, { override: rest });
  }

  /** Daycare reported no nap (or, with false, that he napped after all). */
  async setNoNap(date: DateKey, noNap: boolean) {
    await this.saveDay(date, { no_nap: noNap });
  }

  /** Whether he is at daycare on a date, against the usual daycare days. */
  async setDaycare(date: DateKey, attending: boolean) {
    const { daycare: _was, ...rest } = plain(this.dayRow(date)?.override ?? {});
    const usual = this.settings.daycare_days.includes(isoWeekday(date));
    await this.saveDay(date, { override: attending === usual ? rest : { ...rest, daycare: attending } });
  }

  /** Sleeps that belong to a date, earliest first. */
  sleepsOn(date: DateKey): Sleep[] {
    const tz = this.settings.time_zone;
    return this.sleeps
      .filter((s) => (s.asleep_at || s.in_bed_at) && dayOf(s, tz) === date)
      .sort((a, b) => Date.parse(a.asleep_at ?? a.in_bed_at!) - Date.parse(b.asleep_at ?? b.in_bed_at!));
  }

  async saveSettings(next: AppSettings) {
    const stamped = { ...plain(next), updated_at: new Date().toISOString() };
    await saveSettings(stamped);
    await setMeta('settings_dirty', true);
    this.settings = stamped;
    void this.sync();
  }

  async saveChild(draft: Child) {
    const next = plain(draft);
    await saveChild(next);
    this.child = next;
    const who = this.who;
    if (supabase && this.signedIn && who && who.user_id !== 'local') {
      try {
        await pushChild(who.child_id, next);
        await setMeta('child_dirty', false);
        return;
      } catch {
        // falls through to the flag, and goes up on the next sign-in
      }
    }
    await setMeta('child_dirty', true);
  }

  /** Every sleep, for the CSV export. */
  allSleeps() {
    return db.sleeps.toArray();
  }
}

export const app = new AppState();

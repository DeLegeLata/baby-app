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

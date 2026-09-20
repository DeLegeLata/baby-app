// The one timer rule. The app and the reminders Edge Function both use this file,
// so it stays free of browser and Deno APIs. Every number comes from Settings.

export type Settings = {
  target_min: number;
  max_gap_min: number;
  merge_gap_min: number;
  max_session_min: number;
  running_prompt_min: number;
  emergency_retry_min: number;
  emergency_max_min: number;
  back_to_birth_weight: boolean;
  time_zone: string;
};

export const DEFAULT_SETTINGS: Settings = {
  target_min: 180,
  max_gap_min: 240,
  merge_gap_min: 15,
  max_session_min: 90,
  running_prompt_min: 60,
  emergency_retry_min: 2,
  emergency_max_min: 60,
  back_to_birth_weight: false,
  time_zone: 'America/Toronto'
};

export type Stamp = string | number | Date;

export type Feed = {
  id: string;
  started_at: Stamp;
  ended_at?: Stamp | null;
  deleted_at?: Stamp | null;
};

export type Session = {
  feeds: Feed[];
  startedAt: number;
  /** null while a feed in the session is still running */
  endedAt: number | null;
};

export type AlertType = 'target' | 'max_gap';

export type DueAlert = {
  type: AlertType;
  anchorAt: number;
  dueAt: number;
};

export type TimerState = {
  session: Session | null;
  /** the start of the latest session; every due time counts from here */
  anchorAt: number | null;
  running: boolean;
  sinceAnchorMs: number | null;
  endedAgoMs: number | null;
  /** a feed has been running longer than running_prompt, so the app asks "Still feeding?" */
  stillFeeding: boolean;
  targetAt: number | null;
  /** null when back_to_birth_weight is ticked */
  maxGapAt: number | null;
};

/** What the server should do with a pending wake-to-feed alert right now. */
export type EmergencyAction = 'send' | 'wait' | 'stop';

export type AlertRecord = {
  anchorAt: number;
  type: AlertType;
  firstSentAt: number;
  lastSentAt: number;
  acknowledgedAt?: number | null;
  stoppedAt?: number | null;
};

const MINUTE = 60_000;

export function toMs(v: Stamp): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const parsed = Date.parse(v);
  if (Number.isNaN(parsed)) throw new Error(`bad timestamp: ${v}`);
  return parsed;
}

function live(feeds: Feed[]): Feed[] {
  return feeds
    .filter((f) => !f.deleted_at)
    .slice()
    .sort((a, b) => toMs(a.started_at) - toMs(b.started_at));
}

/**
 * Group feeds into sessions. A feed joins the session before it while the gap
 * from that session end is at most merge_gap AND the whole session would still
 * span at most max_session. A running feed leaves its session open.
 */
export function sessionize(feeds: Feed[], settings: Settings): Session[] {
  const mergeGap = settings.merge_gap_min * MINUTE;
  const maxSession = settings.max_session_min * MINUTE;
  const sessions: Session[] = [];

  for (const feed of live(feeds)) {
    const startedAt = toMs(feed.started_at);
    const endedAt = feed.ended_at ? toMs(feed.ended_at) : null;
    const current = sessions[sessions.length - 1];

    if (current) {
      // A feed starting while another is still running overlaps, so the gap is 0.
      const gap = current.endedAt === null ? 0 : startedAt - current.endedAt;
      const span = (endedAt ?? startedAt) - current.startedAt;
      if (gap <= mergeGap && span <= maxSession) {
        current.feeds.push(feed);
        current.endedAt =
          current.endedAt === null || endedAt === null ? null : Math.max(current.endedAt, endedAt);
        continue;
      }
    }
    sessions.push({ feeds: [feed], startedAt, endedAt });
  }
  return sessions;
}

export function latestSession(feeds: Feed[], settings: Settings): Session | null {
  const sessions = sessionize(feeds, settings);
  return sessions.length ? sessions[sessions.length - 1] : null;
}

/** The instant every due time counts from: the start of the latest session. */
export function anchor(feeds: Feed[], settings: Settings): number | null {
  return latestSession(feeds, settings)?.startedAt ?? null;
}

export function timerState(feeds: Feed[], settings: Settings, now: Stamp = Date.now()): TimerState {
  const at = toMs(now);
  const session = latestSession(feeds, settings);
  if (!session) {
    return {
      session: null,
      anchorAt: null,
      running: false,
      sinceAnchorMs: null,
      endedAgoMs: null,
      stillFeeding: false,
      targetAt: null,
      maxGapAt: null
    };
  }

  const running = session.endedAt === null;
  const runningStarts = session.feeds.filter((f) => !f.ended_at).map((f) => toMs(f.started_at));
  const runningSince = runningStarts.length ? Math.min(...runningStarts) : null;

  return {
    session,
    anchorAt: session.startedAt,
    running,
    sinceAnchorMs: at - session.startedAt,
    endedAgoMs: session.endedAt === null ? null : at - session.endedAt,
    stillFeeding: runningSince !== null && at - runningSince >= settings.running_prompt_min * MINUTE,
    targetAt: session.startedAt + settings.target_min * MINUTE,
    maxGapAt: settings.back_to_birth_weight ? null : session.startedAt + settings.max_gap_min * MINUTE
  };
}

/**
 * Alerts that are due now. A running feed never removes one, because the anchor
 * is the session start either way.
 */
export function dueAlerts(feeds: Feed[], settings: Settings, now: Stamp = Date.now()): DueAlert[] {
  const at = toMs(now);
  const state = timerState(feeds, settings, at);
  if (state.anchorAt === null) return [];

  const due: DueAlert[] = [];
  if (state.targetAt !== null && state.targetAt <= at) {
    due.push({ type: 'target', anchorAt: state.anchorAt, dueAt: state.targetAt });
  }
  if (state.maxGapAt !== null && state.maxGapAt <= at) {
    due.push({ type: 'max_gap', anchorAt: state.anchorAt, dueAt: state.maxGapAt });
  }
  return due;
}

/**
 * Whether to re-send a wake-to-feed alert. It stops when someone taps I am up,
 * when a feed moves the anchor (logged, edited, deleted or arriving late), or at
 * emergency_max. Otherwise it repeats every emergency_retry.
 */
export function emergencyAction(
  alert: AlertRecord,
  feeds: Feed[],
  settings: Settings,
  now: Stamp = Date.now()
): EmergencyAction {
  const at = toMs(now);
  if (alert.acknowledgedAt || alert.stoppedAt) return 'stop';
  if (anchor(feeds, settings) !== alert.anchorAt) return 'stop';
  if (settings.back_to_birth_weight && alert.type === 'max_gap') return 'stop';
  if (at - alert.firstSentAt >= settings.emergency_max_min * MINUTE) return 'stop';
  return at - alert.lastSentAt >= settings.emergency_retry_min * MINUTE ? 'send' : 'wait';
}

// --- Time zone helpers -------------------------------------------------------
// Today and the day of life are counted in the household time zone, across
// daylight-saving changes.

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function localParts(at: Stamp, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(toMs(at)));

  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24, // some runtimes report midnight as 24
    minute: get('minute'),
    second: get('second')
  };
}

function offsetMs(at: number, timeZone: string): number {
  const p = localParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The instant of a wall-clock time in the given zone. A second pass settles DST. */
export function fromLocal(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let at = wall - offsetMs(wall, timeZone);
  at = wall - offsetMs(at, timeZone);
  return at;
}

export function startOfLocalDay(at: Stamp, timeZone: string): number {
  const p = localParts(at, timeZone);
  return fromLocal(timeZone, p.year, p.month, p.day);
}

export function sameLocalDay(a: Stamp, b: Stamp, timeZone: string): boolean {
  return startOfLocalDay(a, timeZone) === startOfLocalDay(b, timeZone);
}

/** Day 1 is the day the baby was born, in the household time zone. */
export function dayOfLife(birth: Stamp, now: Stamp, timeZone: string): number {
  const days = Math.round(
    (startOfLocalDay(now, timeZone) - startOfLocalDay(birth, timeZone)) / 86_400_000
  );
  return days + 1;
}

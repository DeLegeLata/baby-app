// Test A4 in TESTS.md, one describe block per box.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  anchor,
  dayOfLife,
  dueAlerts,
  emergencyAction,
  fromLocal,
  sessionize,
  startOfLocalDay,
  timerState,
  toMs,
  type AlertRecord,
  type Feed,
  type Settings
} from './rule';

const TZ = DEFAULT_SETTINGS.time_zone; // America/Toronto
const S = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

let seq = 0;
const feed = (started: string, ended?: string | null, over: Partial<Feed> = {}): Feed => ({
  id: `f${++seq}`,
  started_at: started,
  ended_at: ended ?? null,
  ...over
});

const HOUR = 3_600_000;
const MIN = 60_000;

describe('merge', () => {
  it('merges a 14 min gap and splits a 16 min gap when merge_gap is 15', () => {
    const first = feed('2026-09-20T10:00:00Z', '2026-09-20T10:20:00Z');
    const merged = sessionize([first, feed('2026-09-20T10:34:00Z', '2026-09-20T10:40:00Z')], S());
    const split = sessionize([first, feed('2026-09-20T10:36:00Z', '2026-09-20T10:40:00Z')], S());

    expect(merged).toHaveLength(1);
    expect(merged[0].feeds).toHaveLength(2);
    expect(split).toHaveLength(2);
  });
});

describe('settings drive the rule', () => {
  it('merges the 16 min case once merge_gap is 20', () => {
    const feeds = [
      feed('2026-09-20T10:00:00Z', '2026-09-20T10:20:00Z'),
      feed('2026-09-20T10:36:00Z', '2026-09-20T10:40:00Z')
    ];
    expect(sessionize(feeds, S({ merge_gap_min: 20 }))).toHaveLength(1);
  });
});

describe('cap', () => {
  it('splits a chain of feeds at max_session', () => {
    // 10 min feeds every 20 min: the 6th would span 110 min, over the 90 min cap.
    const feeds = [0, 20, 40, 60, 80, 100].map((offset) =>
      feed(
        new Date(toMs('2026-09-20T10:00:00Z') + offset * MIN).toISOString(),
        new Date(toMs('2026-09-20T10:10:00Z') + offset * MIN).toISOString()
      )
    );
    const sessions = sessionize(feeds, S());

    expect(sessions).toHaveLength(2);
    expect(sessions[0].feeds).toHaveLength(5);
    expect(sessions[0].endedAt! - sessions[0].startedAt).toBe(90 * MIN);
  });
});

describe('running feed', () => {
  const running = [feed('2026-09-20T09:00:00Z', null)];

  it('anchors on the session start and flags Still feeding after running_prompt', () => {
    const before = timerState(running, S(), '2026-09-20T09:59:00Z');
    const after = timerState(running, S(), '2026-09-20T10:05:00Z');

    expect(after.anchorAt).toBe(toMs('2026-09-20T09:00:00Z'));
    expect(after.running).toBe(true);
    expect(after.endedAgoMs).toBeNull();
    expect(before.stillFeeding).toBe(false);
    expect(after.stillFeeding).toBe(true);
  });

  it('never removes a due time', () => {
    const due = dueAlerts(running, S(), '2026-09-20T12:30:00Z');
    expect(due.map((d) => d.type)).toEqual(['target']);
  });
});

describe('due times', () => {
  const feeds = [feed('2026-09-20T09:00:00Z', '2026-09-20T09:20:00Z')];
  const anchorAt = toMs('2026-09-20T09:00:00Z');

  it('sets the target at anchor + 3 h and the maximum gap at anchor + 4 h', () => {
    const state = timerState(feeds, S(), '2026-09-20T10:00:00Z');
    expect(state.targetAt).toBe(anchorAt + 3 * HOUR);
    expect(state.maxGapAt).toBe(anchorAt + 4 * HOUR);
    expect(state.endedAgoMs).toBe(40 * MIN);
    expect(dueAlerts(feeds, S(), '2026-09-20T13:30:00Z').map((d) => d.type)).toEqual([
      'target',
      'max_gap'
    ]);
  });

  it('drops the maximum gap but keeps the target once back to birth weight', () => {
    const settings = S({ back_to_birth_weight: true });
    expect(timerState(feeds, settings, '2026-09-20T10:00:00Z').maxGapAt).toBeNull();
    expect(dueAlerts(feeds, settings, '2026-09-20T13:30:00Z').map((d) => d.type)).toEqual(['target']);
  });
});

describe('repeats', () => {
  const feeds = [feed('2026-09-20T09:00:00Z', '2026-09-20T09:20:00Z')];
  const anchorAt = toMs('2026-09-20T09:00:00Z');
  const firstSentAt = toMs('2026-09-20T13:00:00Z');
  const alert = (over: Partial<AlertRecord> = {}): AlertRecord => ({
    anchorAt,
    type: 'max_gap',
    firstSentAt,
    lastSentAt: firstSentAt,
    ...over
  });

  it('waits inside the retry interval and sends after it', () => {
    expect(emergencyAction(alert(), feeds, S(), firstSentAt + 1 * MIN)).toBe('wait');
    expect(emergencyAction(alert(), feeds, S(), firstSentAt + 2 * MIN)).toBe('send');
  });

  it('stops at emergency_max, on I am up, and when a feed is logged', () => {
    expect(emergencyAction(alert(), feeds, S(), firstSentAt + 60 * MIN)).toBe('stop');
    expect(
      emergencyAction(alert({ acknowledgedAt: firstSentAt + 3 * MIN }), feeds, S(), firstSentAt + 4 * MIN)
    ).toBe('stop');

    const fed = [...feeds, feed('2026-09-20T13:05:00Z', '2026-09-20T13:20:00Z')];
    expect(emergencyAction(alert(), fed, S(), firstSentAt + 6 * MIN)).toBe('stop');
  });
});

describe('late or changed feeds', () => {
  const feeds = [feed('2026-09-20T09:00:00Z', '2026-09-20T09:20:00Z')];
  const anchorAt = toMs('2026-09-20T09:00:00Z');
  const pending: AlertRecord = {
    anchorAt,
    type: 'max_gap',
    firstSentAt: toMs('2026-09-20T13:00:00Z'),
    lastSentAt: toMs('2026-09-20T13:00:00Z')
  };
  const now = '2026-09-20T13:04:00Z';

  it('moves the anchor when a backdated feed arrives late, and stops the stale alert', () => {
    const late = [...feeds, feed('2026-09-20T11:30:00Z', '2026-09-20T11:45:00Z')];
    expect(anchor(late, S())).toBe(toMs('2026-09-20T11:30:00Z'));
    expect(emergencyAction(pending, late, S(), now)).toBe('stop');
  });

  it('moves the anchor when a feed is edited or deleted', () => {
    const edited = [feed('2026-09-20T10:15:00Z', '2026-09-20T10:35:00Z', { id: feeds[0].id })];
    expect(anchor(edited, S())).toBe(toMs('2026-09-20T10:15:00Z'));

    const withDeleted = [
      feed('2026-09-20T08:00:00Z', '2026-09-20T08:20:00Z'),
      feed('2026-09-20T09:00:00Z', '2026-09-20T09:20:00Z', { deleted_at: '2026-09-20T13:02:00Z' })
    ];
    expect(anchor(withDeleted, S())).toBe(toMs('2026-09-20T08:00:00Z'));
    expect(emergencyAction(pending, withDeleted, S(), now)).toBe('stop');
  });
});

describe('time zone', () => {
  it('counts a local day across both daylight-saving changes', () => {
    // 2026-11-01: the clocks go back, so the local day is 25 h long.
    const fallBack =
      startOfLocalDay('2026-11-02T12:00:00Z', TZ) - startOfLocalDay('2026-11-01T12:00:00Z', TZ);
    // 2027-03-14: the clocks go forward, so the local day is 23 h long.
    const springForward =
      startOfLocalDay('2027-03-15T12:00:00Z', TZ) - startOfLocalDay('2027-03-14T12:00:00Z', TZ);

    expect(fallBack).toBe(25 * HOUR);
    expect(springForward).toBe(23 * HOUR);
  });

  it('puts both 01:30s of the repeated hour on the same local day', () => {
    // 2026-11-01T01:30 happens twice: once at 05:30 UTC (EDT) and once at 06:30 UTC (EST).
    expect(startOfLocalDay('2026-11-01T05:30:00Z', TZ)).toBe(
      startOfLocalDay('2026-11-01T06:30:00Z', TZ)
    );
  });

  it('round-trips a wall-clock time either side of a change', () => {
    expect(fromLocal(TZ, 2026, 11, 1, 0, 0, 0)).toBe(toMs('2026-11-01T04:00:00Z')); // EDT, UTC-4
    expect(fromLocal(TZ, 2026, 11, 2, 0, 0, 0)).toBe(toMs('2026-11-02T05:00:00Z')); // EST, UTC-5
  });

  it('counts the day of life in the household time zone', () => {
    const birth = '2026-11-01T03:00:00Z'; // 23:00 on 2026-10-31, local
    expect(dayOfLife(birth, birth, TZ)).toBe(1);
    expect(dayOfLife(birth, '2026-11-01T04:30:00Z', TZ)).toBe(2); // 00:30 local, 90 min later
    expect(dayOfLife(birth, '2026-11-06T12:00:00Z', TZ)).toBe(7);
  });
});

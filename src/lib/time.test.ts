import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, settingsSchema } from './model';
import {
  HOUR,
  addDays,
  ageInMonths,
  atMinutes,
  dateKey,
  daysBetween,
  fromLocal,
  isoWeekday,
  minutesOf,
  parseClock,
  startOfLocalDay,
  toMs,
  utcOffsetMin
} from './time';

const TZ = 'America/Toronto';

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

  it('reports the offset either side of the November change', () => {
    expect(utcOffsetMin('2026-10-31T16:00:00Z', TZ)).toBe(-240);
    expect(utcOffsetMin('2026-11-01T17:00:00Z', TZ)).toBe(-300);
  });
});

describe('calendar dates', () => {
  it('formats and steps dates across month ends', () => {
    expect(dateKey('2026-10-09T03:30:00Z', TZ)).toBe('2026-10-08'); // 23:30 local
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-25', '2026-11-01')).toBe(7);
  });

  it('numbers the weekdays from Monday', () => {
    expect(isoWeekday('2026-10-05')).toBe(1); // Monday
    expect(isoWeekday('2026-11-01')).toBe(7); // Sunday
  });

  it('reads wall-clock minutes past midnight, rolling into the next day', () => {
    const at = atMinutes('2026-10-08', 20 * 60 + 15, TZ);
    expect(at).toBe(toMs('2026-10-09T00:15:00Z'));
    expect(minutesOf('2026-10-08', at, TZ)).toBe(20 * 60 + 15);
    // 06:30 the next morning is 30:30 on the evening's date.
    const morning = atMinutes('2026-10-08', 30 * 60 + 30, TZ);
    expect(morning).toBe(toMs('2026-10-09T10:30:00Z'));
    expect(minutesOf('2026-10-08', morning, TZ)).toBe(30 * 60 + 30);
  });

  it('keeps wall-clock times on the night the clocks go back', () => {
    // Asleep 20:00 on Oct 31 (EDT), up 06:30 on Nov 1 (EST): 11 h 30 m of real time.
    const asleep = atMinutes('2026-10-31', 20 * 60, TZ);
    const up = atMinutes('2026-10-31', 30 * 60 + 30, TZ);
    expect((up - asleep) / HOUR).toBe(11.5);
  });

  it('parses stored clock strings', () => {
    expect(parseClock('07:00')).toBe(420);
    expect(parseClock('20:15')).toBe(1215);
    expect(() => parseClock('8pm')).toThrow();
  });

  it('counts age in whole months', () => {
    expect(ageInMonths('2024-03-15T12:00:00Z', '2026-10-08T12:00:00Z', TZ)).toBe(30);
    expect(ageInMonths('2023-10-09T12:00:00Z', '2026-10-08T12:00:00Z', TZ)).toBe(35);
    expect(ageInMonths('2023-10-08T12:00:00Z', '2026-10-08T12:00:00Z', TZ)).toBe(36);
  });
});

describe('settings', () => {
  it('refuses a time zone that Intl does not know', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, time_zone: 'Ottawa' }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, time_zone: 'America/Vancouver' }).success).toBe(true);
  });

  it('refuses a nap window that ends before it starts', () => {
    const schedule = { ...DEFAULT_SETTINGS.schedule, nap_start: '14:30', nap_end: '12:30' };
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, schedule }).success).toBe(false);
  });
});

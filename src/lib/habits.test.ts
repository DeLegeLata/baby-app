import { describe, expect, it } from 'vitest';
import type { EngineInput, SleepLike } from './engine';
import {
  habitEffects,
  keptDay,
  minutesOn,
  screenDay,
  sootherDay,
  weanStatus,
  type HabitLike,
  type SootherDay
} from './habits';
import { DEFAULT_SETTINGS } from './model';
import { addDays, atMinutes, parseClock } from './time';

const TZ = 'America/Toronto';

/** An ISO instant for a wall-clock time on a date; '+' rolls into the next day. */
function t(date: string, clock: string): string {
  const next = clock.startsWith('+');
  const minutes = parseClock(next ? clock.slice(1) : clock) + (next ? 24 * 60 : 0);
  return new Date(atMinutes(date, minutes, TZ)).toISOString();
}

let seq = 0;
function habit(kind: HabitLike['kind'], date: string, start: string, end: string | null, stage: number | null = null): HabitLike {
  return { id: `h${++seq}`, kind, start_at: t(date, start), end_at: end ? t(date, end) : null, stage, deleted_at: null };
}

function night(date: string, inBed: string, asleep: string, woke: string, extra: Partial<SleepLike> = {}): SleepLike {
  return {
    id: `s${++seq}`,
    kind: 'night',
    in_bed_at: t(date, inBed),
    asleep_at: t(date, asleep),
    woke_at: t(date, woke),
    wakings: [],
    deleted_at: null,
    ...extra
  };
}

function input(sleeps: SleepLike[], now: string, birth_at: string | null = null): EngineInput {
  return { sleeps, days: [], settings: DEFAULT_SETTINGS, birth_at, now: Date.parse(now) };
}

const D = '2026-10-14';

describe('screen time', () => {
  it('adds up the day, clipping a session that runs past midnight and one still on', () => {
    const habits = [habit('screen', addDays(D, -1), '23:30', '+00:30'), habit('screen', D, '16:00', null)];
    expect(minutesOn(habits, 'screen', D, TZ, Date.parse(t(D, '16:45')))).toBe(30 + 45);
  });

  it('flags a day over the 1-hour guide', () => {
    const habits = [habit('screen', D, '09:00', '09:50'), habit('screen', D, '15:00', '15:30')];
    const day = screenDay(input([], t(D, '17:00')), habits, D, null);
    expect(day.totalMin).toBe(80);
    expect(day.over).toBe(true);
    expect(day.lines[0]).toBe('1 h 20 min of screens today, 20 min over the 1-hour guide.');
  });

  it('notes a screen that ended less than an hour before he went to bed', () => {
    const habits = [habit('screen', D, '18:30', '19:10')];
    const sleeps = [night(D, '19:45', '20:00', '+06:30')];
    const day = screenDay(input(sleeps, t(D, '21:00')), habits, D, null);
    expect(day.tooClose).toBe(35);
    expect(day.bedIsPlan).toBe(false);
    expect(day.lines[1]).toContain('35 min before bed (7:45 p.m.)');
  });

  it('while a screen is on, says when to turn it off to keep the hour before bed clear', () => {
    const habits = [habit('screen', D, '17:00', null)];
    const day = screenDay(input([], t(D, '17:20')), habits, D, Date.parse(t(D, '19:45')));
    expect(day.lines).toContain('Off by 6:45 p.m. keeps the hour before bed clear (in bed by 7:45 p.m.).');
  });

  it('says nothing about bedtime when the last screen ended well before it', () => {
    const habits = [habit('screen', D, '15:00', '15:40')];
    const day = screenDay(input([], t(D, '17:00')), habits, D, Date.parse(t(D, '19:45')));
    expect(day.tooClose).toBeNull();
    expect(day.lines).toEqual(['40 min of screens today, under the 1-hour guide.']);
  });
});

describe('the weaning plan', () => {
  const base: SootherDay = { date: D, dayMin: 0, running: null, napsWith: 0, homeNapsWith: 0, night: null, replugs: 0 };

  it('keeps each stage by its own rule', () => {
    expect(keptDay(1, { ...base, dayMin: 30 })).toBe(true);
    expect(keptDay(1, { ...base, dayMin: 31 })).toBe(false);
    expect(keptDay(2, { ...base, dayMin: 5, night: true })).toBe(false);
    expect(keptDay(2, { ...base, napsWith: 1, night: true })).toBe(true);
    expect(keptDay(3, { ...base, napsWith: 1, homeNapsWith: 0, night: true })).toBe(true);
    expect(keptDay(3, { ...base, napsWith: 1, homeNapsWith: 1 })).toBe(false);
    expect(keptDay(4, { ...base, night: true })).toBe(false);
    expect(keptDay(4, { ...base, replugs: 1 })).toBe(false);
    expect(keptDay(4, base)).toBe(true);
  });

  it('has no plan until one is started, and none after it is stopped', () => {
    expect(weanStatus(input([], t(D, '12:00')), [], D).active).toBe(false);
    const habits = [habit('wean', addDays(D, -10), '09:00', null, 1), habit('wean', addDays(D, -2), '09:00', null, 0)];
    expect(weanStatus(input([], t(D, '12:00')), habits, D).active).toBe(false);
  });

  it('suggests the next stage after 7 full days with 5 kept, never before', () => {
    // Stage 2 began 8 days ago; daytime soother on two of the 7 full days since.
    const habits = [
      habit('wean', addDays(D, -8), '09:00', null, 2),
      habit('soother', addDays(D, -3), '10:00', '10:20'),
      habit('soother', addDays(D, -5), '15:00', '15:10')
    ];
    const status = weanStatus(input([], t(D, '12:00')), habits, D);
    expect(status.stage).toBe(2);
    expect(status.judged).toBe(7);
    expect(status.kept).toBe(5);
    expect(status.suggestNext).toBe(true);

    const early = weanStatus(input([], t(D, '12:00')), [habit('wean', addDays(D, -5), '09:00', null, 2)], D);
    expect(early.judged).toBe(4);
    expect(early.suggestNext).toBe(false);
  });

  it('follows the newest stage change, and a restart after a stop', () => {
    const habits = [
      habit('wean', addDays(D, -30), '09:00', null, 3),
      habit('wean', addDays(D, -20), '09:00', null, 0),
      habit('wean', addDays(D, -6), '09:00', null, 1),
      habit('wean', addDays(D, -1), '09:00', null, 2)
    ];
    const status = weanStatus(input([], t(D, '12:00')), habits, D);
    expect(status.stage).toBe(2);
    expect(status.planSince).toBe(addDays(D, -6));
    expect(status.stageSince).toBe(addDays(D, -1));
  });

  it('counts a night with the soother put back in against stage 4', () => {
    const sleeps = [
      night(addDays(D, -1), '19:30', '19:45', '+06:30', {
        wakings: [{ start: t(addDays(D, -1), '+02:00'), end: t(addDays(D, -1), '+02:10'), soother: true }]
      })
    ];
    const day = sootherDay(input(sleeps, t(D, '12:00')), [], addDays(D, -1));
    expect(day.replugs).toBe(1);
    expect(keptDay(4, day)).toBe(false);
  });
});

describe('screens and the soother against his sleep', () => {
  it('compares nights with a screen in the hour before bed against nights without', () => {
    const sleeps: SleepLike[] = [];
    const habits: HabitLike[] = [];
    for (let i = 1; i <= 6; i++) {
      const date = addDays(D, -i);
      const late = i % 2 === 0;
      sleeps.push(night(date, '19:30', late ? '20:10' : '19:45', '+06:30', { soother: i <= 3 }));
      habits.push(late ? habit('screen', date, '18:50', '19:15') : habit('screen', date, '16:00', '16:30'));
    }
    const effects = habitEffects(input(sleeps, t(D, '12:00')), habits);
    const close = effects.find((e) => e.key === 'screen_hour')!;
    expect(close.withCount).toBe(3);
    expect(close.withoutCount).toBe(3);
    expect(close.settle.with).toBe(40);
    expect(close.settle.without).toBe(15);
    expect(close.line).toContain('took 25 min longer to fall asleep');
    const soother = effects.find((e) => e.key === 'soother_night')!;
    expect(soother.withCount).toBe(3);
    expect(soother.withoutCount).toBe(3);
  });
});

import { describe, expect, it } from 'vitest';
import {
  History,
  chartRows,
  dayOf,
  dstBedtimeShift,
  dstWakeShift,
  guessKind,
  learn,
  phaseOf,
  planBedtime,
  planWake,
  plannedReminders,
  scheduleFor,
  dayIndex,
  sleepBand,
  wakingMinutes,
  weeklySummary,
  type DayLike,
  type EngineInput,
  type SleepLike
} from './engine';
import { clockAt } from './format';
import { DEFAULT_SETTINGS, type AppSettings, type SleepKind } from './model';
import { addDays, atMinutes, parseClock, toMs } from './time';

const TZ = 'America/Toronto';

/** An ISO instant for a wall-clock time on a date; '+' rolls into the next day. */
function t(date: string, clock: string): string {
  const next = clock.startsWith('+');
  const minutes = parseClock(next ? clock.slice(1) : clock) + (next ? 24 * 60 : 0);
  return new Date(atMinutes(date, minutes, TZ)).toISOString();
}

let seq = 0;
function sleep(
  kind: SleepKind,
  date: string,
  asleep: string,
  woke: string | null,
  extra: Partial<SleepLike> = {}
): SleepLike {
  return {
    id: `s${++seq}`,
    kind,
    in_bed_at: null,
    asleep_at: t(date, asleep),
    woke_at: woke ? t(date, woke) : null,
    wakings: [],
    deleted_at: null,
    ...extra
  };
}

function input(
  sleeps: SleepLike[],
  now: string,
  opts: { days?: DayLike[]; settings?: Partial<AppSettings>; birth_at?: string | null } = {}
): EngineInput {
  return {
    sleeps,
    days: opts.days ?? [],
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    birth_at: opts.birth_at === undefined ? '2024-03-15T12:00:00Z' : opts.birth_at,
    now: toMs(now)
  };
}

const clock = (at: number) => clockAt(at, TZ);

/** A normal week: daycare nap 12:30-14:30, asleep at `bed`, up at 06:30. */
function normalDays(lastDate: string, count: number, bed = '20:15', nap: [string, string] = ['12:30', '14:30']) {
  const out: SleepLike[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = addDays(lastDate, -i);
    out.push(sleep('nap', date, nap[0], nap[1]));
    out.push(sleep('night', date, bed, '+06:30'));
  }
  return out;
}

// Thursday 8 October 2026 is a daycare day.
const THU = '2026-10-08';
const SAT = '2026-10-10';

describe('bedtime from the starting point', () => {
  it('uses the usual bedtime and the daycare nap when nothing is logged', () => {
    const plan = planBedtime(input([], t(THU, '10:00')));
    expect(plan.date).toBe(THU);
    expect(clock(plan.asleepBy)).toBe('8:15 p.m.');
    expect(clock(plan.windowStart)).toBe('8:00 p.m.');
    expect(clock(plan.windowEnd)).toBe('8:30 p.m.'); // the latest bedtime caps the window
    expect(clock(plan.inBedBy)).toBe('8:00 p.m.');
    expect(clock(plan.routineAt)).toBe('7:40 p.m.');
    expect(clock(plan.remindAt)).toBe('7:10 p.m.');
    expect(plan.assumptions.join(' ')).toMatch(/Assuming the daycare nap, 12:30 p\.m\. to 2:30 p\.m\./);
    expect(plan.reasons[0]).toMatch(/starting point/);
  });
});

describe("today's nap", () => {
  it('brings bedtime earlier after a short daycare nap', () => {
    const plan = planBedtime(input([sleep('nap', THU, '12:30', '13:15')], t(THU, '17:00')));
    // 37 min for the early end, 19 min for the 75 min shortfall
    expect(clock(plan.asleepBy)).toBe('7:19 p.m.');
    expect(plan.reasons.join(' ')).toMatch(/1 h 15 min before his usual 2:30 p\.m\.: 37 min earlier/);
    expect(plan.reasons.join(' ')).toMatch(/19 min earlier/);
  });

  it('treats a home-day nap as skipped an hour after the window, and moves bedtime an hour earlier', () => {
    const before = planBedtime(input([], t(SAT, '15:00')));
    expect(clock(before.asleepBy)).toBe('8:15 p.m.');
    const after = planBedtime(input([], t(SAT, '16:00')));
    expect(clock(after.asleepBy)).toBe('7:15 p.m.');
    expect(after.assumptions.join(' ')).toMatch(/counts as skipped/);
  });

  it('takes the daycare report of no nap at its word', () => {
    const days: DayLike[] = [
      { date: THU, override: {}, off_tag: null, no_nap: true, deleted_at: null }
    ];
    const plan = planBedtime(input([], t(THU, '17:00'), { days }));
    expect(clock(plan.asleepBy)).toBe('7:15 p.m.');
  });

  it('pushes bedtime a little later for a catnap after the nap', () => {
    const plan = planBedtime(
      input([sleep('nap', THU, '12:30', '14:30'), sleep('catnap', THU, '16:45', '17:05')], t(THU, '17:30'))
    );
    expect(clock(plan.asleepBy)).toBe('8:25 p.m.');
    expect(plan.reasons.join(' ')).toMatch(/Catnap at 4:45 p\.m\.: 10 min later/);
  });

  it('assumes a running nap lasts as long as usual', () => {
    const plan = planBedtime(input([sleep('nap', SAT, '13:00', null)], t(SAT, '13:30')));
    // ends 15:00, 30 min after his usual 14:30: 15 min later
    expect(clock(plan.asleepBy)).toBe('8:30 p.m.');
    expect(plan.assumptions.join(' ')).toMatch(/runs to about 3:00 p\.m\./);
  });
});

describe('the schedule', () => {
  it('never goes past the latest bedtime', () => {
    const plan = planBedtime(input([], t(THU, '10:00'), { settings: { usual_bedtime: '21:00' } }));
    expect(clock(plan.asleepBy)).toBe('8:30 p.m.');
    expect(plan.reasons).toContain('Capped at the latest bedtime, 8:30 p.m.');
  });

  it('leaves room for his usual night before an early must-be-up', () => {
    const settings = { schedule: { ...DEFAULT_SETTINGS.schedule, must_be_up: '06:00' } };
    const plan = planBedtime(input([], t(THU, '10:00'), { settings }));
    // usual night 10 h 15 min before 06:00
    expect(clock(plan.asleepBy)).toBe('7:45 p.m.');
    expect(plan.reasons.join(' ')).toMatch(/10 h 15 min of night sleep before the 6:00 a\.m\. must-be-up/);
  });

  it('moves bedtime to clear a no-sleep window, and says why', () => {
    const settings = {
      schedule: {
        ...DEFAULT_SETTINGS.schedule,
        no_sleep: [{ start: '19:00', end: '19:50', label: 'swimming' }]
      }
    };
    const plan = planBedtime(input([], t(THU, '10:00'), { settings }));
    expect(clock(plan.routineAt)).toBe('7:50 p.m.');
    expect(clock(plan.asleepBy)).toBe('8:25 p.m.');
    expect(plan.reasons.join(' ')).toMatch(/Moved 10 min later to clear the no-sleep window \(swimming/);
  });

  it('applies a date override and the daycare days', () => {
    const days: DayLike[] = [
      { date: THU, override: { must_be_up: null, daycare: false }, off_tag: null, no_nap: false, deleted_at: null }
    ];
    const s = scheduleFor(THU, DEFAULT_SETTINGS, dayIndex(days));
    expect(s.mustBeUp).toBeNull();
    expect(s.daycare).toBe(false);
    expect(s.napStart).toBe(12 * 60 + 30);
    expect(scheduleFor(SAT, DEFAULT_SETTINGS, new Map()).daycare).toBe(false);
    expect(scheduleFor('2026-10-09', DEFAULT_SETTINGS, new Map()).daycare).toBe(true);
  });
});

describe('learning', () => {
  it('pulls his usual bedtime towards what he really does, recent days counting most', () => {
    const h = new History(input(normalDays('2026-10-07', 14, '20:45'), t(THU, '10:00')));
    const learned = learn(h, THU);
    expect(learned.nights).toBe(14);
    expect(learned.bedtime).toBeGreaterThan(20 * 60 + 35);
    expect(learned.bedtime).toBeLessThan(20 * 60 + 45);
    expect(learned.historyShare).toBeGreaterThan(0.75);
  });

  it('does not let a short-nap day drag the usual bedtime down', () => {
    const sleeps = [
      ...normalDays('2026-10-06', 6),
      sleep('nap', '2026-10-07', '12:30', '13:15'),
      sleep('night', '2026-10-07', '19:19', '+06:30')
    ];
    const learned = learn(new History(input(sleeps, t(THU, '10:00'))), THU);
    expect(Math.abs(learned.bedtime - (20 * 60 + 15))).toBeLessThan(6);
  });

  it('leaves unusual days out', () => {
    const sleeps = normalDays('2026-10-07', 7, '21:45');
    const days: DayLike[] = Array.from({ length: 7 }, (_, i) => ({
      date: addDays('2026-10-07', -i),
      override: {},
      off_tag: 'sick' as const,
      no_nap: false,
      deleted_at: null
    }));
    const learned = learn(new History(input(sleeps, t(THU, '10:00'), { days })), THU);
    expect(learned.nights).toBe(0);
    expect(learned.bedtime).toBe(20 * 60 + 15);
  });

  it('learns how long he takes to fall asleep', () => {
    const sleeps: SleepLike[] = [];
    for (let i = 1; i <= 10; i++) {
      const date = addDays(THU, -i);
      sleeps.push(sleep('nap', date, '12:30', '14:30'));
      sleeps.push(sleep('night', date, '20:15', '+06:30', { in_bed_at: t(date, '19:45') }));
    }
    const learned = learn(new History(input(sleeps, t(THU, '10:00'))), THU);
    expect(learned.settle).toBeGreaterThan(26);
    const plan = planBedtime(input(sleeps, t(THU, '10:00')));
    expect(plan.reasons.join(' ')).toMatch(/takes about 2\d min to fall asleep/);
  });
});

describe('morning wake', () => {
  it('suggests his usual wake time once he has had enough night sleep', () => {
    const night = sleep('night', THU, '20:15', null);
    const plan = planWake(input([night], t('2026-10-09', '05:00')), night);
    expect(plan.date).toBe('2026-10-09');
    expect(clock(plan.wakeAt)).toBe('6:30 a.m.');
    expect(clock(plan.mustBeUpAt!)).toBe('7:00 a.m.');
  });

  it('adds time awake in the night, but never past the must-be-up time', () => {
    const night = sleep('night', THU, '20:15', null, {
      wakings: [{ start: t(THU, '+02:00'), end: t(THU, '+02:40') }]
    });
    const plan = planWake(input([night], t('2026-10-09', '05:00')), night);
    expect(clock(plan.enoughAt)).toBe('7:10 a.m.');
    expect(clock(plan.wakeAt)).toBe('7:00 a.m.');
    expect(plan.reasons.join(' ')).toMatch(/10 min short of his usual night/);
  });

  it('does not wake him before his usual time after an early night', () => {
    const night = sleep('night', THU, '19:00', null);
    const plan = planWake(input([night], t('2026-10-09', '05:00')), night);
    expect(clock(plan.enoughAt)).toBe('5:15 a.m.');
    expect(clock(plan.wakeAt)).toBe('6:30 a.m.');
    expect(plan.reasons.join(' ')).toMatch(/Not before his usual wake time/);
  });

  it('wakes at the must-be-up time after a late night', () => {
    const night = sleep('night', THU, '21:30', null);
    const plan = planWake(input([night], t('2026-10-09', '05:00')), night);
    expect(clock(plan.wakeAt)).toBe('7:00 a.m.');
  });
});

describe('the clock changes', () => {
  it('eases bedtime back over four nights after the clocks go back on 1 November', () => {
    const shift = (d: string) => dstBedtimeShift(d, TZ).minutes;
    expect(shift('2026-10-31')).toBe(0);
    expect(shift('2026-11-01')).toBe(-45);
    expect(shift('2026-11-02')).toBe(-30);
    expect(shift('2026-11-03')).toBe(-15);
    expect(shift('2026-11-04')).toBe(0);
    expect(dstBedtimeShift('2026-11-01', TZ).reasons[0]).toMatch(/back to normal by Wednesday/);

    const plan = planBedtime(input([], t('2026-11-01', '10:00')));
    expect(clock(plan.asleepBy)).toBe('7:30 p.m.');
  });

  it('steps bedtime and wake earlier in the four days before the clocks go forward', () => {
    const shift = (d: string) => dstBedtimeShift(d, TZ).minutes;
    expect(shift('2027-03-09')).toBe(0);
    expect(shift('2027-03-10')).toBe(-15);
    expect(shift('2027-03-13')).toBe(-60);
    expect(shift('2027-03-14')).toBe(0);
    expect(dstWakeShift('2027-03-11', TZ)).toBe(-15);
    expect(dstWakeShift('2027-03-13', TZ)).toBe(-45);
    expect(dstWakeShift('2027-03-14', TZ)).toBe(0);
  });
});

describe('days and phases', () => {
  it('puts a night that starts after midnight on the evening before', () => {
    const late = sleep('night', THU, '+00:30', '+07:00');
    expect(dayOf(late, TZ)).toBe(THU);
    expect(dayOf(sleep('nap', THU, '12:30', '14:30'), TZ)).toBe(THU);
  });

  it('knows which day he is in', () => {
    const night = sleep('night', '2026-10-07', '20:15', '+06:30');
    expect(new History(input([night], t(THU, '07:00'))).today()).toBe(THU);
    expect(new History(input([night], t(THU, '23:30'))).today()).toBe(THU);
    expect(new History(input([], t(THU, '+02:00'))).today()).toBe(THU);
  });

  it('reads the phase of the running sleep', () => {
    expect(phaseOf(null)).toBe('awake');
    expect(phaseOf({ ...sleep('night', THU, '20:15', null), asleep_at: null, in_bed_at: t(THU, '20:00') })).toBe(
      'in_bed'
    );
    const waking = sleep('night', THU, '20:15', null, { wakings: [{ start: t(THU, '+01:00'), end: null }] });
    expect(phaseOf(waking)).toBe('waking');
  });

  it('guesses night, nap or catnap from the time of day', () => {
    expect(guessKind(input([], t(THU, '19:50')), 'bed')).toBe('night');
    expect(guessKind(input([], t(THU, '12:20')), 'bed')).toBe('nap');
    expect(guessKind(input([], t(THU, '12:20')), 'asleep')).toBe('nap');
    expect(guessKind(input([], t(THU, '16:40')), 'asleep')).toBe('catnap');
  });

  it('uses the age band for his birth date', () => {
    expect(sleepBand('2024-03-15T12:00:00Z', toMs(t(THU, '10:00')), TZ)).toMatchObject({ minH: 11, maxH: 14 });
    expect(sleepBand('2023-09-01T12:00:00Z', toMs(t(THU, '10:00')), TZ)).toMatchObject({ minH: 10, maxH: 13 });
    expect(sleepBand(null, toMs(t(THU, '10:00')), TZ).assumed).toBe(true);
  });
});

describe('reminders', () => {
  it('plans the routine reminder while he is awake, and the wake reminder overnight', () => {
    const day = plannedReminders(input([], t(THU, '10:00')), 'Sam');
    const bedtime = day.find((r) => r.kind === 'bedtime')!;
    expect(clock(bedtime.sendAt!)).toBe('7:10 p.m.');
    expect(bedtime.body).toBe("Start Sam's routine at 7:40 p.m. Asleep by 8:15 p.m.");
    expect(day.find((r) => r.kind === 'wake')!.sendAt).toBeNull();

    const night = sleep('night', THU, '20:15', null);
    const overnight = plannedReminders(input([night], t(THU, '+01:00')), 'Sam');
    const wake = overnight.find((r) => r.kind === 'wake')!;
    expect(wake.date).toBe('2026-10-09');
    expect(clock(wake.sendAt!)).toBe('6:30 a.m.');
    expect(overnight.find((r) => r.kind === 'bedtime')).toMatchObject({ date: THU, sendAt: null });
  });
});

describe('history', () => {
  it('splits a night across the two diary rows and cuts out the wakings', () => {
    const night = sleep('night', THU, '20:15', '+06:30', {
      wakings: [{ start: t(THU, '+02:00'), end: t(THU, '+02:30') }]
    });
    const rows = chartRows(input([night], t('2026-10-09', '12:00')), '2026-10-09', 2);
    expect(rows[0].segments).toEqual([{ start: 20 * 60 + 15, end: 24 * 60, kind: 'night' }]);
    expect(rows[1].segments).toEqual([
      { start: 0, end: 120, kind: 'night' },
      { start: 150, end: 390, kind: 'night' }
    ]);
  });

  it('writes a weekly summary against the week before', () => {
    const sleeps = [...normalDays('2026-09-30', 7, '20:00'), ...normalDays('2026-10-07', 7, '20:20')];
    const { lines, current } = weeklySummary(input(sleeps, t(THU, '10:00')));
    expect(current.days).toBe(7);
    expect(lines[0]).toBe('Asleep at 8:20 p.m. on average, 20 min later than the week before.');
    expect(lines[1]).toMatch(/Up for the day at 6:30 a\.m\./);
    expect(lines[2]).toMatch(/Night sleep 10 h 10 min, day sleep 2 h: 12 h 10 min a day in all, within the 11 to 14 hours/);
    expect(lines[3]).toBe('No night wakings logged.');
  });

  it('waits for three complete nights before summarising', () => {
    const { lines } = weeklySummary(input(normalDays('2026-10-07', 2), t(THU, '10:00')));
    expect(lines[0]).toMatch(/Not enough logged yet/);
  });
});

describe('fixes from review', () => {
  it('does not move on to tomorrow when an evening doze logged as a night ends the same evening', () => {
    const morning = sleep('night', '2026-10-07', '20:15', '+06:30');
    const doze = sleep('night', THU, '17:15', '17:45');
    const h = new History(input([morning, doze], t(THU, '18:00')));
    expect(h.today()).toBe(THU);
    expect(planBedtime(input([morning, doze], t(THU, '18:00'))).date).toBe(THU);
  });

  it('guesses a catnap, not a night, for a doze in the car at 5:15 p.m.', () => {
    expect(guessKind(input([], t(THU, '17:15')), 'asleep')).toBe('catnap');
    expect(guessKind(input([], t(THU, '18:30')), 'bed')).toBe('night');
  });

  it('never counts a waking past the end of its night', () => {
    const night = sleep('night', THU, '20:15', '+06:30', { wakings: [{ start: t(THU, '+02:00'), end: null }] });
    const aDayLater = toMs(t('2026-10-10', '12:00'));
    expect(wakingMinutes(night, aDayLater)).toBe(270); // 02:00 to 06:30
  });

  it('aims for a longer night after a day with no nap', () => {
    const days: DayLike[] = [{ date: THU, override: {}, off_tag: null, no_nap: true, deleted_at: null }];
    const night = sleep('night', THU, '20:15', null);
    const plan = planWake(input([night], t('2026-10-09', '05:00'), { days }), night);
    // 11 h for his age with no day sleep: enough at 7:15, so the 7:00 must-be-up decides
    expect(clock(plan.enoughAt)).toBe('7:15 a.m.');
    expect(clock(plan.wakeAt)).toBe('7:00 a.m.');
  });
});


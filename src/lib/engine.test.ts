import { describe, expect, it } from 'vitest';
import {
  History,
  activityEffects,
  bathEvents,
  bathStatus,
  daycareEntry,
  type BathLike,
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
import { DEFAULT_SETTINGS, settingsSchema, type Activity, type AppSettings, type SleepKind } from './model';
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
  opts: { days?: DayLike[]; settings?: Partial<AppSettings>; birth_at?: string | null; baths?: BathLike[] } = {}
): EngineInput {
  return {
    sleeps,
    days: opts.days ?? [],
    baths: opts.baths ?? [],
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

describe('what he did before sleep', () => {
  /** A night on `date` with the given activities, settling time and waking. */
  function night(date: string, activities: Activity[], settleMin: number, wakeMin: number, up: string) {
    const inBed = '19:55';
    const asleepAt = atMinutes(date, parseClock(inBed) + settleMin, TZ);
    return {
      ...sleep('night', date, '20:00', up, {
        in_bed_at: t(date, inBed),
        activities,
        wakings: wakeMin ? [{ start: t(date, '+02:00'), end: t(date, `+02:${String(wakeMin).padStart(2, '0')}`) }] : []
      }),
      asleep_at: new Date(asleepAt).toISOString()
    };
  }

  // Four calm nights with books and a bath, four with a screen: Oct 1 to Oct 8.
  const calm = ['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07'].map((d) => night(d, ['books', 'bath'], 10, 0, '+06:35'));
  const screen = ['2026-10-02', '2026-10-04', '2026-10-06', '2026-10-08'].map((d) => night(d, ['screen'], 25, 20, '+06:20'));

  it('compares the nights with an activity against the nights without it', () => {
    const { nights, effects } = activityEffects(input([...calm, ...screen], t('2026-10-09', '10:00')));
    expect(nights).toBe(8);
    const books = effects.find((e) => e.activity === 'books' && e.kind === 'night')!;
    expect(books).toMatchObject({ withCount: 4, withoutCount: 4, enough: true });
    expect(books.settle).toEqual({ with: 10, without: 25 });
    // books: asleep 20:05 to 06:35 = 630 min; screen: 20:20 to 06:20 less 20 awake = 580 min
    expect(books.length).toEqual({ with: 630, without: 580 });
    expect(books.line).toBe(
      'Books (4 nights with it, 4 without): fell asleep 15 min faster, 1.0 fewer night wakings a night and slept 50 min longer.'
    );
    const tv = effects.find((e) => e.activity === 'screen')!;
    expect(tv.line).toBe(
      'TV or screen (4 nights with it, 4 without): took 15 min longer to fall asleep, 1.0 more night wakings a night and slept 50 min less.'
    );
  });

  it('only counts nights where something was recorded, and leaves out unusual days', () => {
    const blank = sleep('night', '2026-09-30', '20:00', '+06:30');
    const days: DayLike[] = [{ date: '2026-10-08', override: {}, off_tag: 'sick', no_nap: false, deleted_at: null }];
    const { nights, effects } = activityEffects(input([blank, ...calm, ...screen], t('2026-10-09', '10:00'), { days }));
    expect(nights).toBe(7);
    expect(effects.find((e) => e.activity === 'screen')!.withCount).toBe(3);
  });

  it('waits for three nights each way before comparing', () => {
    const few = [calm[0], calm[1], screen[0]];
    const { effects } = activityEffects(input(few, t('2026-10-09', '10:00')));
    const books = effects.find((e) => e.activity === 'books')!;
    expect(books.enough).toBe(false);
    expect(books.line).toBe(
      'Books: 2 nights with it and 1 without so far. The comparison appears once there are at least 3 of each.'
    );
  });
});

describe('baths', () => {
  const bath = (id: string, at: string): BathLike => ({ id, at, deleted_at: null });

  it('is due when nothing is logged', () => {
    const status = bathStatus(input([], t(THU, '10:00')));
    expect(status).toMatchObject({ due: true, line: 'No bath logged yet.' });
  });

  it('falls due the set number of days after the last bath', () => {
    const baths = [bath('b1', t('2026-10-05', '18:30'))];
    const wed = bathStatus(input([], t('2026-10-07', '10:00'), { baths }));
    expect(wed).toMatchObject({ due: false, daysSince: 2, dueOn: '2026-10-08' });
    expect(wed.line).toBe('Last bath Monday, 2 days ago. Next one due tomorrow.');
    const thu = bathStatus(input([], t(THU, '10:00'), { baths }));
    expect(thu.due).toBe(true);
    expect(thu.line).toBe('Last bath Monday, 3 days ago. Due today.');
    const sat = bathStatus(input([], t(SAT, '10:00'), { baths }));
    expect(sat.line).toBe('Last bath Monday, 5 days ago. Due since Thursday.');
    const every2 = bathStatus(input([], t('2026-10-07', '10:00'), { baths, settings: { bath_every_days: 2 } }));
    expect(every2.line).toBe('Last bath Monday, 2 days ago. Due today.');
  });

  it('counts a bath given as part of the bedtime routine, once', () => {
    const routine = sleep('night', '2026-10-07', '20:10', '+06:30', { in_bed_at: t('2026-10-07', '19:50'), activities: ['bath', 'books'] });
    const alone = bathStatus(input([routine], t(THU, '10:00')));
    expect(alone.events).toHaveLength(1);
    expect(alone.events[0].source).toBe('routine');
    expect(alone.line).toBe('Last bath yesterday. Next one due Saturday.');
    // The same bath logged in the tracker too: one bath, not two.
    const both = bathEvents(input([routine], t(THU, '10:00'), { baths: [bath('b1', t('2026-10-07', '19:30'))] }));
    expect(both.map((e) => e.source)).toEqual(['log']);
  });

  it('counts a bath the moment it is logged, though the clock moves by the minute', () => {
    // The engine sees 19:30:00; "Bath done" was tapped at 19:30:40.
    const justNow = bath('b2', new Date(toMs(t(THU, '19:30')) + 40_000).toISOString());
    const status = bathStatus(input([], t(THU, '19:30'), { baths: [bath('b1', t('2026-10-05', '18:30')), justNow] }));
    expect(status).toMatchObject({ due: false, line: 'Bath today. Next one due Sunday.' });
  });

  it('plans the bath reminder on a due day, and cancels it once a bath is in', () => {
    const remind = (baths: BathLike[], settings: Partial<AppSettings> = {}) =>
      plannedReminders(input([], t(THU, '10:00'), { baths, settings }), 'Sam').find((r) => r.kind === 'bath')!;
    const due = remind([bath('b1', t('2026-10-05', '18:30'))]);
    expect(clock(due.sendAt!)).toBe('5:00 p.m.');
    expect(due).toMatchObject({ date: THU, title: 'Bath day for Sam', body: 'Last bath Monday, 3 days ago. Due today.' });
    expect(remind([bath('b1', t('2026-10-05', '18:30')), bath('b2', t(THU, '09:00'))]).sendAt).toBeNull();
    expect(remind([bath('b1', t('2026-10-05', '18:30'))], { bath_remind_at: null }).sendAt).toBeNull();
  });

  it('still loads settings saved before the bath settings existed', () => {
    const { bath_every_days, bath_remind_at, ...older } = DEFAULT_SETTINGS;
    const saved = { ...older, usual_bedtime: '20:40', schedule: { ...older.schedule, must_be_up: '06:45' } };
    const parsed = settingsSchema.parse(saved);
    expect(parsed).toMatchObject({ bath_every_days: 3, bath_remind_at: '17:00', usual_bedtime: '20:40' });
    expect(parsed.schedule.must_be_up).toBe('06:45');
  });
});

describe('the daycare card', () => {
  const min = (clock: string) => parseClock(clock);

  it('treats times still to come as the plan, and finished ones as what happened', () => {
    const before = daycareEntry(THU, min('13:00'), min('15:00'), toMs(t(THU, '09:00')), TZ);
    expect(before.kind).toBe('plan');
    const during = daycareEntry(THU, min('13:00'), min('15:00'), toMs(t(THU, '14:00')), TZ);
    expect(during.kind).toBe('plan');
    const after = daycareEntry(THU, min('12:45'), min('14:10'), toMs(t(THU, '17:00')), TZ);
    expect(after).toMatchObject({ kind: 'actual', startAt: toMs(t(THU, '12:45')), endAt: toMs(t(THU, '14:10')) });
  });

  it('refuses a nap that ends before it starts', () => {
    expect(daycareEntry(THU, min('14:00'), min('13:00'), toMs(t(THU, '17:00')), TZ)).toEqual({
      kind: 'error',
      message: 'The nap has to end after it starts.'
    });
  });

  it('moves tonight\'s bedtime with a changed plan, then with the report', () => {
    // Daycare says at drop-off: nap 1:00 to 3:00 today. Bedtime assumes that window.
    const days: DayLike[] = [
      { date: THU, override: { nap_start: '13:00', nap_end: '15:00' }, off_tag: null, no_nap: false, deleted_at: null }
    ];
    const planned = planBedtime(input([], t(THU, '09:00'), { days }));
    expect(clock(planned.asleepBy)).toBe('8:30 p.m.'); // ends 30 min after the usual: 15 min later, capped at 8:30
    // At pickup the report says 1:10 to 2:00: the real nap takes over. It ended 30 min
    // before the usual 2:30 (15 min earlier) and day sleep was 70 min short (18 min earlier).
    const reported = planBedtime(input([sleep('nap', THU, '13:10', '14:00')], t(THU, '17:00'), { days }));
    expect(clock(reported.asleepBy)).toBe('7:42 p.m.');
  });
});


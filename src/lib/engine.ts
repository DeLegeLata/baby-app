// The sleep engine: what the logged sleeps say about his usual day, and what
// that means for tonight's bedtime and tomorrow's wake-up. Pure functions over
// plain data, free of browser APIs, so the tests drive every rule and the
// numbers can be tuned in one place.
//
// How a bedtime is reached:
//  1. Start from his usual bedtime. Until there is history this is the starting
//     point from Settings; each logged day then pulls it towards what he really
//     does, recent days counting most (half weight after a week, 28 days kept).
//  2. Adjust for today's nap: a nap that ends earlier or later than usual moves
//     bedtime by half the difference, a short day of sleep brings it earlier,
//     no nap brings it earlier still, and a late catnap pushes it a little later.
//  3. Ease across a daylight-saving change in 15-minute steps.
//  4. Respect the schedule: never past the latest bedtime, early enough for his
//     usual night before tomorrow's must-be-up, and clear of no-sleep windows.
//     Every adjustment is written down, so the screen can say why.
import { clock12, clockAt, dur, tidy, weekdayName } from './format';
import type { AppSettings, DayRow, OffTag, Sleep, SleepKind } from './model';
import {
  DAY_MIN,
  HOUR,
  MINUTE,
  addDays,
  ageInMonths,
  atMinutes,
  dateKey,
  daysBetween,
  isoWeekday,
  minutesOf,
  parseClock,
  toMs,
  utcOffsetMin,
  type DateKey
} from './time';

// --- Tunable numbers ------------------------------------------------------------

export const TUNING = {
  /** days of history used, and the half-life of a day's weight */
  historyDays: 28,
  halfLifeDays: 7,
  /** how many days' worth of weight the starting point carries */
  priorWeight: 2,
  /** bedtime moves by this share of the difference in nap end time */
  napEndShare: 0.5,
  /** and earlier by this share of any shortfall in day sleep */
  shortNapShare: 0.25,
  /** with no nap at all: half the usual nap, at most 90 min earlier */
  noNapShare: 0.5,
  noNapMaxMin: 90,
  /** a catnap after the nap pushes bedtime later by half its length, up to 30 min of it */
  lateCatnapShare: 0.5,
  lateCatnapCapMin: 30,
  /** a home-day nap not logged this long after the window ends counts as skipped */
  napGraceMin: 60,
  /** half-width of the bedtime window, from his day-to-day spread */
  windowMinMin: 10,
  windowMaxMin: 25,
  windowDefaultMin: 15,
  wakeWindowMin: 10,
  /** the clock-change plan moves bedtime in steps of this size */
  dstStepMin: 15
} as const;

// --- Inputs --------------------------------------------------------------------

export type SleepLike = Pick<
  Sleep,
  'id' | 'kind' | 'in_bed_at' | 'asleep_at' | 'woke_at' | 'wakings' | 'deleted_at'
> &
  Partial<Pick<Sleep, 'place' | 'mood' | 'note'>>;

export type DayLike = Pick<DayRow, 'date' | 'override' | 'off_tag' | 'no_nap' | 'deleted_at'> &
  Partial<Pick<DayRow, 'note'>>;

export type EngineInput = {
  sleeps: SleepLike[];
  days: DayLike[];
  settings: AppSettings;
  birth_at: string | null;
  now: number;
};

// --- Basic facts about a sleep ---------------------------------------------------

export function startMs(s: SleepLike): number | null {
  const at = s.asleep_at ?? s.in_bed_at;
  return at ? toMs(at) : null;
}

function live(sleeps: SleepLike[]): SleepLike[] {
  return sleeps
    .filter((s) => !s.deleted_at && startMs(s) !== null)
    .sort((a, b) => startMs(a)! - startMs(b)!);
}

/**
 * The date a sleep belongs to. A night belongs to the evening it started, even
 * if he only went down after midnight; naps belong to the day they are in.
 */
export function dayOf(s: SleepLike, timeZone: string): DateKey {
  const at = startMs(s)!;
  return s.kind === 'night' ? dateKey(at - 12 * HOUR, timeZone) : dateKey(at, timeZone);
}

/**
 * Minutes awake in the night. An open waking counts up to `now` while the
 * night runs, and no waking counts past the morning wake once it has ended.
 */
export function wakingMinutes(s: SleepLike, now: number): number {
  const limit = s.woke_at ? toMs(s.woke_at) : now;
  let total = 0;
  for (const w of s.wakings ?? []) {
    const start = toMs(w.start);
    const end = Math.min(w.end ? toMs(w.end) : limit, limit);
    if (end > start) total += (end - start) / MINUTE;
  }
  return total;
}

export function openWaking(s: SleepLike | null): boolean {
  return Boolean(s?.wakings?.some((w) => !w.end));
}

/** Net minutes asleep, up to `now` while it is still running. */
export function netSleepMinutes(s: SleepLike, now: number): number {
  if (!s.asleep_at) return 0;
  const end = s.woke_at ? toMs(s.woke_at) : now;
  return Math.max(0, (end - toMs(s.asleep_at)) / MINUTE - wakingMinutes(s, end));
}

// --- The schedule for a date -----------------------------------------------------

export type Window = { start: number; end: number; label: string };

export type DaySchedule = {
  date: DateKey;
  mustBeUp: number | null;
  napStart: number | null;
  napEnd: number | null;
  latestBedtime: number | null;
  noSleep: Window[];
  daycare: boolean;
  off: OffTag | null;
  noNap: boolean;
  overridden: boolean;
};

export function dayIndex(days: DayLike[]): Map<DateKey, DayLike> {
  const map = new Map<DateKey, DayLike>();
  for (const d of days) if (!d.deleted_at) map.set(d.date, d);
  return map;
}

const toMin = (c: string | null | undefined) => (c ? parseClock(c) : null);

export function scheduleFor(
  date: DateKey,
  settings: AppSettings,
  days: Map<DateKey, DayLike>
): DaySchedule {
  const row = days.get(date);
  const o = row?.override ?? {};
  const t = settings.schedule;
  const pick = (key: 'must_be_up' | 'nap_start' | 'nap_end' | 'latest_bedtime'): string | null =>
    key in o ? (o[key] ?? null) : t[key];

  const windows = (o.no_sleep ?? t.no_sleep).map((w) => {
    const start = parseClock(w.start);
    let end = parseClock(w.end);
    if (end <= start) end += DAY_MIN; // runs past midnight
    return { start, end, label: w.label };
  });

  return {
    date,
    mustBeUp: toMin(pick('must_be_up')),
    napStart: toMin(pick('nap_start')),
    napEnd: toMin(pick('nap_end')),
    latestBedtime: toMin(pick('latest_bedtime')),
    noSleep: windows,
    daycare: o.daycare ?? settings.daycare_days.includes(isoWeekday(date)),
    off: row?.off_tag ?? null,
    noNap: row?.no_nap ?? false,
    overridden: Object.keys(o).length > 0
  };
}

// --- Age guidance ----------------------------------------------------------------

export type SleepBand = { minH: number; maxH: number; label: string; assumed: boolean };

/**
 * Hours of sleep per 24 h, naps included: the Canadian 24-Hour Movement
 * Guidelines for the Early Years (0-4 years), which match the American Academy
 * of Sleep Medicine consensus (Paruthi et al., 2016) for these ages.
 */
export function sleepBand(birth_at: string | null, now: number, timeZone: string): SleepBand {
  if (!birth_at) return { minH: 11, maxH: 14, label: 'toddlers (ages 1 and 2)', assumed: true };
  const months = ageInMonths(birth_at, now, timeZone);
  if (months < 12) return { minH: 12, maxH: 16, label: 'infants (4 to 11 months)', assumed: false };
  if (months < 36) return { minH: 11, maxH: 14, label: 'toddlers (ages 1 and 2)', assumed: false };
  if (months < 60) return { minH: 10, maxH: 13, label: 'preschoolers (ages 3 and 4)', assumed: false };
  return { minH: 9, maxH: 12, label: 'children aged 5 to 13', assumed: false };
}

// --- What happened on a date -------------------------------------------------------

export type Span = { start: number; end: number; len: number; open: boolean };

export type DayFacts = {
  date: DateKey;
  off: boolean;
  /** his main nap: the longest sleep logged as a nap */
  nap: Span | null;
  catnaps: Span[];
  /** naps and catnaps together, minutes */
  daySleep: number;
  /** the night that starts this evening, in minutes from this date's midnight */
  night: {
    inBed: number | null;
    asleep: number | null;
    end: number | null;
    settle: number | null;
    net: number | null;
    wakings: number;
    wakingMin: number;
    sleep: SleepLike;
  } | null;
  /** when he got up this morning (the end of last night), minutes from this midnight */
  morningWake: number | null;
};

export class History {
  readonly tz: string;
  readonly byDay = new Map<DateKey, SleepLike[]>();
  readonly days: Map<DateKey, DayLike>;
  readonly sleeps: SleepLike[];
  private factsCache = new Map<DateKey, DayFacts>();

  constructor(readonly input: EngineInput) {
    this.tz = input.settings.time_zone;
    this.sleeps = live(input.sleeps);
    this.days = dayIndex(input.days);
    for (const s of this.sleeps) {
      const key = dayOf(s, this.tz);
      const list = this.byDay.get(key) ?? [];
      list.push(s);
      this.byDay.set(key, list);
    }
  }

  schedule(date: DateKey): DaySchedule {
    return scheduleFor(date, this.input.settings, this.days);
  }

  private span(date: DateKey, s: SleepLike): Span | null {
    if (!s.asleep_at) return null;
    const start = minutesOf(date, s.asleep_at, this.tz);
    const endAt = s.woke_at ? toMs(s.woke_at) : this.input.now;
    const len = Math.max(0, (endAt - toMs(s.asleep_at)) / MINUTE - wakingMinutes(s, endAt));
    return { start, end: minutesOf(date, endAt, this.tz), len, open: !s.woke_at };
  }

  facts(date: DateKey): DayFacts {
    const cached = this.factsCache.get(date);
    if (cached) return cached;

    const list = this.byDay.get(date) ?? [];
    const naps = list
      .filter((s) => s.kind === 'nap')
      .map((s) => this.span(date, s))
      .filter((s): s is Span => s !== null)
      .sort((a, b) => b.len - a.len);
    const catnaps = list
      .filter((s) => s.kind === 'catnap')
      .map((s) => this.span(date, s))
      .filter((s): s is Span => s !== null);
    // A second nap counts as a catnap: the main nap is the longest.
    const nap = naps[0] ?? null;
    const extra = [...naps.slice(1), ...catnaps].sort((a, b) => a.start - b.start);

    const nightSleep = list
      .filter((s) => s.kind === 'night')
      .sort((a, b) => netSleepMinutes(b, this.input.now) - netSleepMinutes(a, this.input.now))[0];

    let night: DayFacts['night'] = null;
    if (nightSleep) {
      const asleep = nightSleep.asleep_at ? minutesOf(date, nightSleep.asleep_at, this.tz) : null;
      const inBed = nightSleep.in_bed_at ? minutesOf(date, nightSleep.in_bed_at, this.tz) : null;
      const ended = nightSleep.woke_at && nightSleep.asleep_at;
      night = {
        inBed,
        asleep,
        end: nightSleep.woke_at ? minutesOf(date, nightSleep.woke_at, this.tz) : null,
        settle: asleep !== null && inBed !== null ? asleep - inBed : null,
        net: ended ? netSleepMinutes(nightSleep, this.input.now) : null,
        wakings: (nightSleep.wakings ?? []).length,
        wakingMin: wakingMinutes(nightSleep, this.input.now),
        sleep: nightSleep
      };
    }

    const before = this.byDay.get(addDays(date, -1)) ?? [];
    const lastNight = before.find((s) => s.kind === 'night' && s.woke_at);
    const morningWake = lastNight?.woke_at ? minutesOf(date, lastNight.woke_at, this.tz) : null;

    const facts: DayFacts = {
      date,
      off: Boolean(this.days.get(date)?.off_tag),
      nap,
      catnaps: extra,
      daySleep: (nap?.len ?? 0) + extra.reduce((sum, c) => sum + c.len, 0),
      night,
      morningWake
    };
    this.factsCache.set(date, facts);
    return facts;
  }

  /** The running sleep, if any. */
  current(): SleepLike | null {
    const open = this.sleeps.filter((s) => !s.woke_at);
    return open.length ? open[open.length - 1] : null;
  }

  /** When he last woke from any sleep. */
  lastWoke(): number | null {
    let latest: number | null = null;
    for (const s of this.sleeps) {
      if (s.woke_at) latest = Math.max(latest ?? 0, toMs(s.woke_at));
    }
    return latest;
  }

  /**
   * The day he is in now: the day after the last night that ended in the past
   * 20 hours, else the calendar date (an evening runs on until 4 a.m.). A
   * "night" that ended on the evening it began (a car doze logged as a night)
   * does not start a new day.
   */
  today(): DateKey {
    const now = this.input.now;
    const nights = this.sleeps.filter(
      (s) => s.kind === 'night' && s.woke_at && dateKey(s.woke_at, this.tz) !== dayOf(s, this.tz)
    );
    const last = nights[nights.length - 1];
    if (last && now - toMs(last.woke_at!) < 20 * HOUR && toMs(last.woke_at!) <= now) {
      return addDays(dayOf(last, this.tz), 1);
    }
    return dateKey(now - 4 * HOUR, this.tz);
  }
}

// --- Today's nap, real or assumed -------------------------------------------------

export type NapScenario = {
  kind: 'actual' | 'running' | 'assumed' | 'skipped';
  nap: { start: number; end: number; len: number } | null;
  catnaps: Span[];
  note: string | null;
};

export function napScenario(
  facts: DayFacts,
  sched: DaySchedule,
  usualNapLen: number,
  nowMin: number
): NapScenario {
  const catnaps = facts.catnaps;
  if (facts.nap && !facts.nap.open) {
    return { kind: 'actual', nap: facts.nap, catnaps, note: null };
  }
  if (facts.nap) {
    // Looking back at history, a nap left running counts as a usual-length nap.
    const usualEnd = facts.nap.start + usualNapLen;
    const end = Number.isFinite(nowMin) ? Math.max(nowMin, usualEnd) : usualEnd;
    return {
      kind: 'running',
      nap: { start: facts.nap.start, end, len: end - facts.nap.start },
      catnaps,
      note: `Assuming the nap runs to about ${clock12(end)}.`
    };
  }
  if (sched.noNap) {
    return { kind: 'skipped', nap: null, catnaps, note: 'Daycare reported no nap today.' };
  }
  if (sched.napStart !== null && sched.napEnd !== null) {
    const window = `${clock12(sched.napStart)} to ${clock12(sched.napEnd)}`;
    const nap = { start: sched.napStart, end: sched.napEnd, len: sched.napEnd - sched.napStart };
    if (sched.daycare) {
      return {
        kind: 'assumed',
        nap,
        catnaps,
        note: `Assuming the daycare nap, ${window}. Add their report at pickup to update this.`
      };
    }
    if (nowMin < sched.napEnd + TUNING.napGraceMin) {
      return {
        kind: 'assumed',
        nap,
        catnaps,
        note: nowMin < sched.napStart ? `Planning on his nap, ${window}.` : `Assuming his nap, ${window}.`
      };
    }
    return {
      kind: 'skipped',
      nap: null,
      catnaps,
      note: `No nap logged by ${clock12(sched.napEnd + TUNING.napGraceMin)}, so it counts as skipped.`
    };
  }
  return { kind: 'skipped', nap: null, catnaps, note: 'No nap planned today.' };
}

export type Adjustment = { minutes: number; reasons: string[] };

/** How today's nap moves bedtime from his usual. */
export function napEffect(scn: NapScenario, usual: { napLen: number; napEnd: number }): Adjustment {
  const reasons: string[] = [];
  let minutes = 0;
  const catTotal = scn.catnaps.reduce((sum, c) => sum + c.len, 0);
  let lateFrom: number;

  if (scn.nap) {
    const endDelta = scn.nap.end - usual.napEnd;
    const byEnd = Math.round(TUNING.napEndShare * endDelta);
    if (Math.abs(byEnd) >= 5) {
      minutes += byEnd;
      reasons.push(
        `Nap ${scn.kind === 'actual' ? 'ended' : 'ends'} at ${clock12(scn.nap.end)}, ${dur(Math.abs(endDelta))} ${
          endDelta < 0 ? 'before' : 'after'
        } his usual ${clock12(usual.napEnd)}: ${dur(Math.abs(byEnd))} ${byEnd < 0 ? 'earlier' : 'later'}.`
      );
    }
    const daySleep = scn.nap.len + catTotal;
    const short = usual.napLen - daySleep;
    const byShort = short > 0 ? -Math.round(TUNING.shortNapShare * short) : 0;
    if (byShort <= -5) {
      minutes += byShort;
      reasons.push(
        `Day sleep ${dur(daySleep)}, ${dur(short)} short of his usual ${dur(usual.napLen)}: ${dur(-byShort)} earlier.`
      );
    }
    lateFrom = scn.nap.end;
  } else {
    const short = Math.max(0, usual.napLen - catTotal);
    const byNone = -Math.round(Math.min(TUNING.noNapMaxMin, TUNING.noNapShare * short));
    if (byNone < 0) {
      minutes += byNone;
      reasons.push(
        catTotal > 0
          ? `No real nap today (catnaps ${dur(catTotal)}): ${dur(-byNone)} earlier.`
          : `No nap today: ${dur(-byNone)} earlier.`
      );
    }
    lateFrom = usual.napEnd;
  }

  for (const c of scn.catnaps) {
    if (c.start < lateFrom) continue;
    const later = Math.round(TUNING.lateCatnapShare * Math.min(c.len, TUNING.lateCatnapCapMin));
    if (later < 1) continue;
    minutes += later;
    reasons.push(`Catnap at ${clock12(c.start)}: ${dur(later)} later.`);
  }

  return { minutes, reasons };
}

// --- Daylight saving -----------------------------------------------------------------

/** The next date (within `withinDays`) whose clocks differ from the day before. */
export function clockChange(
  from: DateKey,
  timeZone: string,
  withinDays: number,
  direction: 1 | -1 = 1
): { date: DateKey; deltaMin: number } | null {
  const noonOffset = (key: DateKey) => utcOffsetMin(atMinutes(key, 12 * 60, timeZone), timeZone);
  for (let i = 0; i <= withinDays; i++) {
    const key = addDays(from, direction * i);
    const delta = noonOffset(key) - noonOffset(addDays(key, -1));
    if (delta !== 0) return { date: key, deltaMin: delta };
  }
  return null;
}

/**
 * The bedtime step for a date in the clock-change plan. Both plans only ever
 * move bedtime earlier than normal, so they never collide with the latest
 * bedtime or the must-be-up time.
 *  - Clocks go back: his body runs an hour early afterwards, so bedtime starts
 *    45 min early on the day of the change and eases back by 15 min a night.
 *  - Clocks go forward: in the four nights before, bedtime comes 15 min
 *    earlier each night, so he lands on the new clock already adjusted.
 */
export function dstBedtimeShift(date: DateKey, timeZone: string): Adjustment {
  const step = TUNING.dstStepMin;
  const back = clockChange(date, timeZone, 3, -1);
  if (back && back.deltaMin < 0) {
    const after = daysBetween(back.date, date);
    const minutes = -(step * (3 - after));
    if (minutes < 0) {
      const normal = weekdayName(addDays(back.date, 3));
      return {
        minutes,
        reasons: [
          `The clocks went back on ${weekdayName(back.date)}: ${dur(-minutes)} earlier tonight, easing back to normal by ${normal}.`
        ]
      };
    }
  }
  const ahead = clockChange(addDays(date, 1), timeZone, 3, 1);
  if (ahead && ahead.deltaMin > 0) {
    const before = daysBetween(date, ahead.date); // 1..4
    const minutes = -(step * (5 - before));
    return {
      minutes,
      reasons: [
        `The clocks go forward on ${weekdayName(ahead.date)}: bedtime moves ${dur(step)} earlier each night, ${dur(-minutes)} tonight.`
      ]
    };
  }
  return { minutes: 0, reasons: [] };
}

/** The matching step for a morning: after a moved-up bedtime, his wake moves up too. */
export function dstWakeShift(morning: DateKey, timeZone: string): number {
  const ahead = clockChange(morning, timeZone, 3, 1);
  if (!ahead || ahead.deltaMin <= 0 || ahead.date === morning) return 0;
  return dstBedtimeShift(addDays(morning, -1), timeZone).minutes;
}

// --- Learning ------------------------------------------------------------------------

export type Learned = {
  napLen: number;
  napEnd: number;
  bedtime: number;
  settle: number;
  night: number;
  wake: number;
  bedtimeSpread: number;
  /** how many logged nights went into the bedtime */
  nights: number;
  /** share of the bedtime that comes from his history rather than the starting point */
  historyShare: number;
};

class Mean {
  private sw = 0;
  private swx = 0;
  private items: { w: number; x: number }[] = [];
  add(x: number, w: number) {
    this.sw += w;
    this.swx += w * x;
    this.items.push({ w, x });
  }
  get count() {
    return this.items.length;
  }
  get weight() {
    return this.sw;
  }
  /** shrunk towards the starting point, which counts as priorWeight days */
  shrunk(prior: number): number {
    const k = TUNING.priorWeight;
    return (k * prior + this.swx) / (k + this.sw);
  }
  spread(around: number, fallback: number): number {
    if (this.sw < 2) return fallback;
    const v = this.items.reduce((s, i) => s + i.w * (i.x - around) ** 2, 0) / this.sw;
    return Math.sqrt(v);
  }
}

export function learn(h: History, before: DateKey): Learned {
  const st = h.input.settings;
  const template = scheduleFor(before, st, new Map());
  const prior = {
    napLen:
      template.napStart !== null && template.napEnd !== null ? template.napEnd - template.napStart : 120,
    napEnd: template.napEnd ?? 14 * 60 + 30,
    bedtime: parseClock(st.usual_bedtime),
    wake: parseClock(st.usual_wake),
    settle: st.settle_min,
    night: parseClock(st.usual_wake) + DAY_MIN - parseClock(st.usual_bedtime)
  };

  const napLen = new Mean();
  const napEnd = new Mean();
  const settle = new Mean();
  const night = new Mean();
  const wake = new Mean();
  const kept: { facts: DayFacts; w: number }[] = [];

  for (let i = 1; i <= TUNING.historyDays; i++) {
    const date = addDays(before, -i);
    const f = h.facts(date);
    if (f.off) continue;
    const w = 0.5 ** ((i - 1) / TUNING.halfLifeDays);
    kept.push({ facts: f, w });
    if (f.nap && !f.nap.open) {
      napLen.add(f.nap.len, w);
      napEnd.add(f.nap.end, w);
    }
    const n = f.night;
    if (n?.settle != null && n.settle >= 0 && n.settle <= 120) settle.add(n.settle, w);
    if (n?.net != null && n.net >= 6 * 60 && n.net <= 14 * 60) night.add(n.net, w);
    if (n?.end != null) {
      const up = n.end - DAY_MIN;
      if (up >= 4 * 60 && up <= 10 * 60) wake.add(up, w);
    }
  }

  const usualNap = { napLen: napLen.shrunk(prior.napLen), napEnd: napEnd.shrunk(prior.napEnd) };

  // Each bedtime is read back to what it would have been on a normal day, so a
  // run of short naps does not drag his usual bedtime down with it.
  const bedtime = new Mean();
  for (const { facts, w } of kept) {
    const asleep = facts.night?.asleep;
    if (asleep == null || asleep < 16 * 60 || asleep > DAY_MIN + 120) continue;
    const scn = napScenario(facts, h.schedule(facts.date), usualNap.napLen, Infinity);
    const normal =
      asleep - napEffect(scn, usualNap).minutes - dstBedtimeShift(facts.date, h.tz).minutes;
    bedtime.add(normal, w);
  }
  const usualBedtime = bedtime.shrunk(prior.bedtime);

  return {
    ...usualNap,
    bedtime: usualBedtime,
    settle: settle.shrunk(prior.settle),
    night: night.shrunk(prior.night),
    wake: wake.shrunk(prior.wake),
    bedtimeSpread: bedtime.spread(usualBedtime, TUNING.windowDefaultMin),
    nights: bedtime.count,
    historyShare: bedtime.weight / (bedtime.weight + TUNING.priorWeight)
  };
}

// --- Tonight's bedtime ------------------------------------------------------------------

export type BedtimePlan = {
  date: DateKey;
  /** the recommended time to be asleep, and the window around it */
  asleepBy: number;
  windowStart: number;
  windowEnd: number;
  inBedBy: number;
  routineAt: number;
  remindAt: number;
  reasons: string[];
  assumptions: string[];
  learned: Learned;
};

export function planBedtime(input: EngineInput, onDate?: DateKey): BedtimePlan {
  const h = new History(input);
  const tz = h.tz;
  const st = input.settings;
  const date = onDate ?? h.today();
  const sched = h.schedule(date);
  const learned = learn(h, date);
  const facts = h.facts(date);
  const nowMin = minutesOf(date, input.now, tz);
  const reasons: string[] = [];
  const assumptions: string[] = [];

  const history =
    learned.nights === 0
      ? 'your starting point in Settings; it learns as you log'
      : `learned from ${learned.nights} ${learned.nights === 1 ? 'night' : 'nights'}, recent ones counting most`;
  reasons.push(`His usual bedtime is ${clock12(learned.bedtime)} (${history}).`);

  let bed = learned.bedtime;

  const scn = napScenario(facts, sched, learned.napLen, nowMin);
  if (scn.note) assumptions.push(scn.note);
  const nap = napEffect(scn, learned);
  bed += nap.minutes;
  reasons.push(...nap.reasons);

  const dst = dstBedtimeShift(date, tz);
  bed += dst.minutes;
  reasons.push(...dst.reasons);

  // Enough night before tomorrow's must-be-up.
  const band = sleepBand(input.birth_at, input.now, tz);
  const daySleep = scn.nap ? scn.nap.len + scn.catnaps.reduce((s, c) => s + c.len, 0) : facts.daySleep;
  const nightNeed = Math.max(learned.night, band.minH * 60 - daySleep);
  const tomorrow = h.schedule(addDays(date, 1));
  let ceiling: number | null = null;
  if (tomorrow.mustBeUp !== null) {
    const byNight = tomorrow.mustBeUp + DAY_MIN - nightNeed;
    if (bed > byNight) {
      bed = byNight;
      reasons.push(
        `Brought to ${clock12(byNight)} so he gets ${dur(nightNeed)} of night sleep before the ${clock12(tomorrow.mustBeUp)} must-be-up.`
      );
    }
    ceiling = byNight;
  }
  if (sched.latestBedtime !== null) {
    if (bed > sched.latestBedtime) {
      bed = sched.latestBedtime;
      reasons.push(`Capped at the latest bedtime, ${clock12(sched.latestBedtime)}.`);
    }
    ceiling = ceiling === null ? sched.latestBedtime : Math.min(ceiling, sched.latestBedtime);
  }

  // The routine and settling must not run into a time he has to stay awake.
  const settle = Math.round(learned.settle);
  const lead = st.routine_min + settle;
  for (const w of [...sched.noSleep].sort((a, b) => a.start - b.start)) {
    if (w.end > bed - lead && w.start < bed + 12 * 60) {
      const moved = w.end + lead;
      if (moved <= bed) continue;
      const label = w.label ? `${w.label}, ` : '';
      reasons.push(
        `Moved ${dur(moved - bed)} later to clear the no-sleep window (${label}${clock12(w.start)} to ${clock12(w.end)}).`
      );
      if (ceiling !== null && moved > ceiling) {
        reasons.push(`That is past ${clock12(ceiling)}, but no earlier time fits around the window.`);
      }
      bed = moved;
    }
  }

  bed = Math.round(bed);
  const half = Math.round(
    Math.min(TUNING.windowMaxMin, Math.max(TUNING.windowMinMin, learned.bedtimeSpread))
  );
  const windowStart = bed - half;
  const windowEnd = ceiling !== null && bed <= ceiling ? Math.min(bed + half, ceiling) : bed + half;

  const inBed = bed - settle;
  const routine = inBed - st.routine_min;
  reasons.push(
    `Start the routine at ${clock12(routine)}: ${dur(st.routine_min)} of routine, then he usually takes about ${dur(settle)} to fall asleep.`
  );

  return {
    date,
    asleepBy: atMinutes(date, bed, tz),
    windowStart: atMinutes(date, windowStart, tz),
    windowEnd: atMinutes(date, windowEnd, tz),
    inBedBy: atMinutes(date, inBed, tz),
    routineAt: atMinutes(date, routine, tz),
    remindAt: atMinutes(date, routine - st.reminder_lead_min, tz),
    reasons: reasons.map(tidy),
    assumptions: assumptions.map(tidy),
    learned
  };
}

// --- Tomorrow morning ----------------------------------------------------------------------

export type WakePlan = {
  /** the morning's date */
  date: DateKey;
  wakeAt: number;
  windowStart: number;
  windowEnd: number;
  enoughAt: number;
  mustBeUpAt: number | null;
  reasons: string[];
};

/** For a night in progress: when to wake him if he is still asleep. */
export function planWake(input: EngineInput, night: SleepLike): WakePlan {
  const h = new History(input);
  const tz = h.tz;
  const nightDate = dayOf(night, tz);
  const morning = addDays(nightDate, 1);
  const learned = learn(h, morning);
  const reasons: string[] = [];

  const asleepAt = night.asleep_at
    ? toMs(night.asleep_at)
    : toMs(night.in_bed_at!) + learned.settle * MINUTE;
  const asleepMin = minutesOf(morning, asleepAt, tz);
  const band = sleepBand(input.birth_at, input.now, tz);
  // The day before this night: what he slept, or the daycare nap it assumed.
  const day = napScenario(h.facts(nightDate), h.schedule(nightDate), learned.napLen, Infinity);
  const daySleep = (day.nap?.len ?? 0) + day.catnaps.reduce((s, c) => s + c.len, 0);
  const need = Math.max(learned.night, band.minH * 60 - daySleep);
  const awake = wakingMinutes(night, input.now);
  const enough = asleepMin + need + awake;

  reasons.push(
    `${night.asleep_at ? 'Asleep' : 'In bed'} at ${clock12(asleepMin)}. His usual night is ${dur(need)}${
      awake >= 1 ? `, plus ${dur(awake)} awake in the night` : ''
    }: enough by ${clock12(enough)}.`
  );

  const floor = Math.round(learned.wake + dstWakeShift(morning, tz));
  let wake = enough;
  if (floor > wake) {
    wake = floor;
    reasons.push(`Not before his usual wake time, ${clock12(floor)}, to keep his body clock steady.`);
  }

  const mustBeUp = h.schedule(morning).mustBeUp;
  if (mustBeUp !== null) {
    if (wake > mustBeUp) {
      wake = mustBeUp;
      const short = enough - mustBeUp;
      reasons.push(
        `Must be up by ${clock12(mustBeUp)}${
          short >= 5 ? `, so he will be ${dur(short)} short of his usual night` : ''
        }.`
      );
    } else {
      reasons.push(`Must be up by ${clock12(mustBeUp)}.`);
    }
  }

  wake = Math.round(wake);
  const windowEnd = mustBeUp !== null ? Math.min(wake + TUNING.wakeWindowMin, mustBeUp) : wake + TUNING.wakeWindowMin;
  return {
    date: morning,
    wakeAt: atMinutes(morning, wake, tz),
    windowStart: atMinutes(morning, wake - TUNING.wakeWindowMin, tz),
    windowEnd: atMinutes(morning, Math.max(wake, windowEnd), tz),
    enoughAt: atMinutes(morning, enough, tz),
    mustBeUpAt: mustBeUp !== null ? atMinutes(morning, mustBeUp, tz) : null,
    reasons: reasons.map(tidy)
  };
}

// --- Where he is now ---------------------------------------------------------------------

export type Phase = 'awake' | 'in_bed' | 'asleep' | 'waking';

export function phaseOf(s: SleepLike | null): Phase {
  if (!s) return 'awake';
  if (!s.asleep_at) return 'in_bed';
  return openWaking(s) ? 'waking' : 'asleep';
}

/**
 * The kind a new sleep most likely is: night from two hours before his usual
 * bedtime until 5 a.m., otherwise a nap if he is put down or it falls near the
 * nap window, otherwise a catnap (the car, the stroller).
 */
export function guessKind(
  input: EngineInput,
  how: 'bed' | 'asleep',
  at: number = input.now
): SleepKind {
  const tz = input.settings.time_zone;
  const date = dateKey(at, tz);
  const min = minutesOf(date, at, tz);
  const nightFrom = Math.min(parseClock(input.settings.usual_bedtime), 21 * 60) - 120;
  if (min >= nightFrom || min < 5 * 60) return 'night';
  if (how === 'bed') return 'nap';
  const sched = scheduleFor(date, input.settings, dayIndex(input.days));
  if (sched.napStart !== null && sched.napEnd !== null && min >= sched.napStart - 90 && min <= sched.napEnd) {
    return 'nap';
  }
  return 'catnap';
}

// --- Reminders ------------------------------------------------------------------------------

export type ReminderKind = 'bedtime' | 'wake';

export type PlannedReminder = {
  kind: ReminderKind;
  date: DateKey;
  /** null cancels any reminder already planned for this date */
  sendAt: number | null;
  title: string;
  body: string;
};

/** What the reminder server should send, as the phone sees it now. */
export function plannedReminders(input: EngineInput, name: string): PlannedReminder[] {
  const h = new History(input);
  const tz = h.tz;
  const cur = h.current();
  const out: PlannedReminder[] = [];
  const today = h.today();

  if (cur && cur.kind === 'night') {
    const plan = planWake(input, cur);
    out.push({
      kind: 'wake',
      date: plan.date,
      sendAt: plan.wakeAt,
      title: `Time to wake ${name}`,
      body: tidy(
        plan.mustBeUpAt !== null
          ? `He has had his night, and must be up by ${clockAt(plan.mustBeUpAt, tz)}.`
          : 'He has had his night. Waking him now keeps his day on track.'
      )
    });
    out.push({ kind: 'bedtime', date: dayOf(cur, tz), sendAt: null, title: '', body: '' });
    return out;
  }

  // Awake, or napping: plan tonight, and cancel a morning reminder he no longer needs.
  const plan = planBedtime(input, today);
  out.push({
    kind: 'bedtime',
    date: plan.date,
    sendAt: plan.remindAt,
    title: `Bedtime routine in ${dur(input.settings.reminder_lead_min)}`,
    body: tidy(`Start ${name}'s routine at ${clockAt(plan.routineAt, tz)}. Asleep by ${clockAt(plan.asleepBy, tz)}.`)
  });
  out.push({ kind: 'wake', date: today, sendAt: null, title: '', body: '' });
  return out;
}

// --- History views ----------------------------------------------------------------------------

export type ChartSegment = { start: number; end: number; kind: SleepKind | 'in_bed' };
export type ChartRow = { date: DateKey; off: OffTag | null; overridden: boolean; segments: ChartSegment[] };

/** Midnight-to-midnight rows, as a paediatric sleep diary draws them. */
export function chartRows(input: EngineInput, lastDate: DateKey, count: number): ChartRow[] {
  const h = new History(input);
  const tz = h.tz;
  const rows: ChartRow[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = addDays(lastDate, -i);
    const dayStart = atMinutes(date, 0, tz);
    const dayEnd = atMinutes(date, DAY_MIN, tz);
    const toRowMin = (at: number) => Math.min(DAY_MIN, Math.max(0, minutesOf(date, at, tz)));
    const segments: ChartSegment[] = [];
    const add = (from: number, to: number, kind: ChartSegment['kind']) => {
      const a = Math.max(from, dayStart);
      const b = Math.min(to, dayEnd);
      if (b > a) segments.push({ start: toRowMin(a), end: toRowMin(b), kind });
    };
    for (const s of h.sleeps) {
      const end = s.woke_at ? toMs(s.woke_at) : input.now;
      if (s.in_bed_at && s.asleep_at) add(toMs(s.in_bed_at), toMs(s.asleep_at), 'in_bed');
      if (!s.asleep_at) {
        if (s.in_bed_at) add(toMs(s.in_bed_at), end, 'in_bed');
        continue;
      }
      // Asleep, with the night wakings cut out.
      let from = toMs(s.asleep_at);
      const wakings = [...(s.wakings ?? [])].sort((a, b) => toMs(a.start) - toMs(b.start));
      for (const w of wakings) {
        const ws = toMs(w.start);
        add(from, ws, s.kind);
        from = w.end ? toMs(w.end) : end;
      }
      add(from, end, s.kind);
    }
    const sched = h.schedule(date);
    rows.push({ date, off: sched.off, overridden: sched.overridden, segments });
  }
  return rows;
}

export type NightStat = {
  date: DateKey;
  off: OffTag | null;
  inBed: number | null;
  asleep: number | null;
  /** minutes of the next date */
  up: number | null;
  night: number | null;
  wakings: number;
  wakingMin: number;
  nap: Span | null;
  daySleep: number;
  total: number | null;
  note: string | null;
};

/** One line per date: his day and the night that followed it. */
export function dayStats(input: EngineInput, lastDate: DateKey, count: number): NightStat[] {
  const h = new History(input);
  const out: NightStat[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = addDays(lastDate, -i);
    const f = h.facts(date);
    const n = f.night;
    out.push({
      date,
      off: h.days.get(date)?.off_tag ?? null,
      inBed: n?.inBed ?? null,
      asleep: n?.asleep ?? null,
      up: n?.end != null ? n.end - DAY_MIN : null,
      night: n?.net ?? null,
      wakings: n?.wakings ?? 0,
      wakingMin: n?.wakingMin ?? 0,
      nap: f.nap,
      daySleep: f.daySleep,
      total: n?.net != null ? n.net + f.daySleep : null,
      note: h.days.get(date)?.note ?? null
    });
  }
  return out;
}

export type Averages = {
  days: number;
  bedtime: number | null;
  up: number | null;
  night: number | null;
  nap: number | null;
  total: number | null;
  wakings: number;
  offDays: number;
};

export function averages(stats: NightStat[]): Averages {
  const usable = stats.filter((s) => !s.off);
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const nights = usable.filter((s) => s.night !== null);
  return {
    days: nights.length,
    bedtime: avg(nights.map((s) => s.asleep)),
    up: avg(nights.map((s) => s.up)),
    night: avg(nights.map((s) => s.night)),
    nap: avg(usable.filter((s) => s.nap && !s.nap.open).map((s) => s.daySleep)),
    total: avg(nights.map((s) => s.total)),
    wakings: nights.reduce((sum, s) => sum + s.wakings, 0),
    offDays: stats.length - usable.length
  };
}

/** The written weekly summary: the last seven full days against the seven before. */
export function weeklySummary(input: EngineInput): { lines: string[]; current: Averages; previous: Averages } {
  const h = new History(input);
  const yesterday = addDays(h.today(), -1);
  const current = averages(dayStats(input, yesterday, 7));
  const previous = averages(dayStats(input, addDays(yesterday, -7), 7));
  const band = sleepBand(input.birth_at, input.now, h.tz);
  const lines: string[] = [];

  if (current.days < 3) {
    lines.push(
      `Not enough logged yet for a weekly summary: ${current.days} of the last 7 nights are complete. It appears once 3 are.`
    );
    return { lines, current, previous };
  }

  const compare = (now: number | null, then: number | null, later: string, earlier: string) => {
    if (now === null || then === null || previous.days < 3) return '';
    const d = Math.round(now - then);
    if (Math.abs(d) < 5) return ', about the same as the week before';
    return `, ${dur(Math.abs(d))} ${d > 0 ? later : earlier} than the week before`;
  };

  if (current.bedtime !== null) {
    lines.push(
      `Asleep at ${clock12(current.bedtime)} on average${compare(current.bedtime, previous.bedtime, 'later', 'earlier')}.`
    );
  }
  if (current.up !== null) {
    lines.push(`Up for the day at ${clock12(current.up)} on average${compare(current.up, previous.up, 'later', 'earlier')}.`);
  }
  if (current.night !== null) {
    const parts = [`Night sleep ${dur(current.night)}`];
    if (current.nap !== null) parts.push(`day sleep ${dur(current.nap)}`);
    let line = parts.join(', ');
    if (current.total !== null) {
      const hours = current.total / 60;
      const where =
        hours < band.minH ? 'below' : hours > band.maxH ? 'above' : 'within';
      line += `: ${dur(current.total)} a day in all, ${where} the ${band.minH} to ${band.maxH} hours advised for ${band.label}`;
      if (band.assumed) line += ' (add his birth date in Settings to be sure of the age band)';
    }
    lines.push(`${line}.`);
  }
  lines.push(
    current.wakings === 0
      ? 'No night wakings logged.'
      : `Woke in the night ${current.wakings} ${current.wakings === 1 ? 'time' : 'times'} over ${current.days} nights${
          previous.days >= 3 ? ` (${previous.wakings} the week before)` : ''
        }.`
  );
  if (current.offDays) {
    lines.push(`${current.offDays} unusual ${current.offDays === 1 ? 'day is' : 'days are'} left out of these averages.`);
  }
  return { lines: lines.map(tidy), current, previous };
}

// --- Small helpers the screens share ------------------------------------------------------------

export function minutesSinceMidnight(at: number, timeZone: string): number {
  return minutesOf(dateKey(at, timeZone), at, timeZone);
}

// Screen time, the soother and the weaning plan. Pure functions over plain
// data, like the engine, so the tests drive every rule (research/10).
//
// Screens follow the Canadian Paediatric Society: under 1 hour a day at ages 2
// to 5, and none in the hour before bed. The soother follows its advice to keep
// it to sleep and comfort and give it up by 3 to 4, in four stages that only a
// parent moves.
import { History, compareSleeps, dayOf, type EngineInput, type SleepEffect, type SleepLike } from './engine';
import { clockAt, dur, tidy, weekdayName } from './format';
import type { Habit, HabitKind } from './model';
import { MINUTE, addDays, ageInMonths, atMinutes, dateKey, daysBetween, toMs, type DateKey } from './time';

export type HabitLike = Pick<Habit, 'id' | 'kind' | 'start_at' | 'end_at' | 'stage' | 'deleted_at'> &
  Partial<Pick<Habit, 'note'>>;

/** the guide: under this many minutes of screens a day */
export const SCREEN_LIMIT_MIN = 60;
/** and none in this many minutes before bed */
export const SCREEN_CLEAR_MIN = 60;

/** Live sessions of a kind, earliest first. */
export function sessions(habits: HabitLike[], kind: HabitKind): HabitLike[] {
  return habits
    .filter((h) => !h.deleted_at && h.kind === kind)
    .sort((a, b) => toMs(a.start_at) - toMs(b.start_at));
}

const endOf = (h: HabitLike, now: number) => (h.end_at ? toMs(h.end_at) : now);

/** Minutes of a kind inside a date (midnight to midnight), a running one counting up to now. */
export function minutesOn(habits: HabitLike[], kind: HabitKind, date: DateKey, timeZone: string, now: number): number {
  const from = atMinutes(date, 0, timeZone);
  const to = Math.min(atMinutes(addDays(date, 1), 0, timeZone), now);
  let total = 0;
  for (const h of sessions(habits, kind)) {
    const start = Math.max(toMs(h.start_at), from);
    const end = Math.min(endOf(h, now), to);
    if (end > start) total += (end - start) / MINUTE;
  }
  return total;
}

/** Whether any session of a kind overlaps a span of time. */
function overlaps(habits: HabitLike[], kind: HabitKind, from: number, to: number, now: number): boolean {
  return sessions(habits, kind).some((h) => toMs(h.start_at) < to && endOf(h, now) > from);
}

/** The night that starts on a date, if one has been logged. */
function nightOn(h: History, date: DateKey): SleepLike | null {
  return (h.byDay.get(date) ?? []).find((s) => s.kind === 'night') ?? null;
}

// --- Screens ----------------------------------------------------------------------------

export type ScreenDay = {
  date: DateKey;
  totalMin: number;
  over: boolean;
  running: HabitLike | null;
  /** when the last screen of the day ended */
  lastEnd: number | null;
  /** bed tonight: when he went to bed, else the plan's in-bed time */
  bedAt: number | null;
  bedIsPlan: boolean;
  /** minutes from the last screen to bed, when that is under the hour */
  tooClose: number | null;
  lines: string[];
};

/**
 * The day's screens against the guide. `plannedInBed` is tonight's plan (the
 * bedtime card's "in bed by"), used until he has actually gone to bed.
 */
export function screenDay(
  input: EngineInput,
  habits: HabitLike[],
  date: DateKey,
  plannedInBed: number | null
): ScreenDay {
  const tz = input.settings.time_zone;
  const now = input.now;
  const h = new History(input);
  const totalMin = minutesOn(habits, 'screen', date, tz, now);
  const from = atMinutes(date, 0, tz);
  const to = atMinutes(addDays(date, 1), 0, tz);
  const onDay = sessions(habits, 'screen').filter((s) => toMs(s.start_at) < to && endOf(s, now) > from);
  const running = onDay.find((s) => !s.end_at) ?? null;
  const ended = onDay.filter((s) => s.end_at).map((s) => toMs(s.end_at!));
  const lastEnd = ended.length ? Math.max(...ended) : null;

  const night = nightOn(h, date);
  const actualBed = night ? (night.in_bed_at ?? night.asleep_at) : null;
  const bedAt = actualBed ? toMs(actualBed) : plannedInBed;
  const bedIsPlan = !actualBed;

  let tooClose: number | null = null;
  if (bedAt !== null && lastEnd !== null && !running) {
    const gap = (bedAt - lastEnd) / MINUTE;
    if (gap >= 0 && gap < SCREEN_CLEAR_MIN) tooClose = gap;
  }

  const over = totalMin > SCREEN_LIMIT_MIN;
  const at = (ms: number) => clockAt(ms, tz);
  const lines: string[] = [];
  if (totalMin < 1) lines.push(running ? 'Screens on now.' : onDay.length ? 'Under a minute of screens today.' : 'No screens today.');
  else if (over) lines.push(`${dur(totalMin)} of screens today, ${dur(totalMin - SCREEN_LIMIT_MIN)} over the 1-hour guide.`);
  else if (Math.round(totalMin) === SCREEN_LIMIT_MIN) lines.push(`${dur(totalMin)} of screens today, right at the 1-hour guide.`);
  else lines.push(`${dur(totalMin)} of screens today, under the 1-hour guide.`);

  if (running) {
    lines.push(`On since ${at(toMs(running.start_at))}.`);
    if (bedAt !== null && bedIsPlan && bedAt > now) {
      const offBy = bedAt - SCREEN_CLEAR_MIN * MINUTE;
      lines.push(
        offBy > now
          ? `Off by ${at(offBy)} keeps the hour before bed clear (in bed by ${at(bedAt)}).`
          : `It is now within the hour before bed (in bed by ${at(bedAt)}).`
      );
    }
  } else if (tooClose !== null && lastEnd !== null) {
    const bed = bedIsPlan ? `bedtime (in bed by ${at(bedAt!)})` : `bed (${at(bedAt!)})`;
    lines.push(
      `The last screen ended at ${at(lastEnd)}, ${dur(tooClose)} before ${bed}. The guide is none in the hour before bed.`
    );
  }
  return { date, totalMin, over, running, lastEnd, bedAt, bedIsPlan, tooClose, lines: lines.map(tidy) };
}

// --- The soother ---------------------------------------------------------------------------

export type SootherDay = {
  date: DateKey;
  /** daytime use, outside sleeps */
  dayMin: number;
  running: HabitLike | null;
  /** naps and catnaps he went down for with it, and those at home */
  napsWith: number;
  homeNapsWith: number;
  /** the night that starts this evening: went down with it (null if not said) */
  night: boolean | null;
  /** night wakings where it was put back in */
  replugs: number;
};

export function sootherDay(input: EngineInput, habits: HabitLike[], date: DateKey, h = new History(input)): SootherDay {
  const tz = input.settings.time_zone;
  const list = h.byDay.get(date) ?? [];
  const naps = list.filter((s) => s.kind !== 'night' && s.soother === true);
  const night = nightOn(h, date);
  return {
    date,
    dayMin: minutesOn(habits, 'soother', date, tz, input.now),
    running: sessions(habits, 'soother').find((s) => !s.end_at) ?? null,
    napsWith: naps.length,
    homeNapsWith: naps.filter((s) => s.place !== 'daycare').length,
    night: night ? (night.soother ?? null) : null,
    replugs: night ? (night.wakings ?? []).filter((w) => w.soother).length : 0
  };
}

export type SootherWeek = { sleepsWith: number; sleepsAnswered: number; dayMin: number; replugs: number; lines: string[] };

/** The last 7 days, today included. */
export function sootherWeek(input: EngineInput, habits: HabitLike[], today: DateKey): SootherWeek {
  const h = new History(input);
  let sleepsWith = 0;
  let sleepsAnswered = 0;
  let dayMin = 0;
  let replugs = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(today, -i);
    for (const s of h.byDay.get(date) ?? []) {
      if (s.soother === true || s.soother === false) sleepsAnswered += 1;
      if (s.soother === true) sleepsWith += 1;
    }
    const day = sootherDay(input, habits, date, h);
    dayMin += day.dayMin;
    replugs += day.replugs;
  }
  const lines: string[] = [];
  lines.push(
    sleepsAnswered
      ? `Last 7 days: went down with it for ${sleepsWith} of ${sleepsAnswered} sleeps.`
      : 'Last 7 days: no sleeps with a soother answer yet.'
  );
  lines.push(`${dur(dayMin)} in the day, and put back in ${replugs} ${replugs === 1 ? 'time' : 'times'} at night.`);
  return { sleepsWith, sleepsAnswered, dayMin, replugs, lines };
}

// --- The weaning plan -----------------------------------------------------------------------

export type WeanStage = { stage: number; name: string; allowed: string; rule: string };

export const WEAN_STAGES: WeanStage[] = [
  { stage: 1, name: 'Sleep and comfort', allowed: 'Sleeps, plus short comfort when he is upset', rule: 'daytime use adds up to 30 min or less' },
  { stage: 2, name: 'Sleeps only', allowed: 'Naps and night', rule: 'there is no daytime use' },
  { stage: 3, name: 'Night only', allowed: 'Night sleep only', rule: 'there is no daytime use and no home nap with it' },
  { stage: 4, name: 'Gone', allowed: 'None (the soother fairy has been)', rule: 'there is no use at all, including at night' }
];

/** stage 1 allows this much daytime comfort */
export const WEAN_COMFORT_MAX_MIN = 30;
/** the next stage is suggested once a stage has run this many full days */
export const WEAN_MIN_DAYS = 7;
/** with at least this many of the last 7 kept */
export const WEAN_KEPT_OF_7 = 5;

/** Whether a day kept a stage's rule. */
export function keptDay(stage: number, day: SootherDay): boolean {
  if (stage <= 1) return day.dayMin <= WEAN_COMFORT_MAX_MIN;
  if (stage === 2) return day.dayMin < 1;
  if (stage === 3) return day.dayMin < 1 && day.homeNapsWith === 0;
  return day.dayMin < 1 && day.napsWith === 0 && day.night !== true && day.replugs === 0;
}

export type NightAverages = { nights: number; settle: number | null; wakings: number | null };

function nightAverages(h: History, from: DateKey, until: DateKey): NightAverages {
  const settles: number[] = [];
  const wakings: number[] = [];
  for (let date = from; date < until; date = addDays(date, 1)) {
    const facts = h.facts(date);
    const night = facts.night;
    if (facts.off || !night || night.end === null || night.asleep === null) continue;
    wakings.push(night.wakings);
    if (night.settle !== null && night.settle >= 0 && night.settle <= 120) settles.push(night.settle);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return { nights: wakings.length, settle: mean(settles), wakings: mean(wakings) };
}

export type WeanStatus = {
  active: boolean;
  /** 0 when there is no plan */
  stage: number;
  info: WeanStage | null;
  stageSince: DateKey | null;
  planSince: DateKey | null;
  /** full days since the stage began */
  fullDays: number;
  /** the stage's full days looked at (at most the last 7), and how many kept the rule */
  judged: number;
  kept: number;
  todayKept: boolean | null;
  suggestNext: boolean;
  before: NightAverages | null;
  during: NightAverages | null;
  lines: string[];
};

/** The plan's current stage, from the newest run of stage changes after the last stop. */
export function weanStatus(input: EngineInput, habits: HabitLike[], today: DateKey): WeanStatus {
  const tz = input.settings.time_zone;
  const changes = sessions(habits, 'wean').filter((w) => w.stage !== null);
  const stop = changes.map((w) => w.stage).lastIndexOf(0);
  const run = changes.slice(stop + 1);
  const lines: string[] = [];

  const months = input.birth_at ? ageInMonths(input.birth_at, input.now, tz) : null;
  const age =
    months !== null
      ? `He is ${months} months old. The Canadian Paediatric Society says to plan to give it up by 3 to 4, and dentists say by about 3.`
      : 'The Canadian Paediatric Society says to plan to give it up by 3 to 4, and dentists say by about 3.';

  if (!run.length) {
    return {
      active: false,
      stage: 0,
      info: null,
      stageSince: null,
      planSince: null,
      fullDays: 0,
      judged: 0,
      kept: 0,
      todayKept: null,
      suggestNext: false,
      before: null,
      during: null,
      lines: [age]
    };
  }

  const h = new History(input);
  const current = run[run.length - 1];
  const stage = Math.min(4, Math.max(1, current.stage!));
  const info = WEAN_STAGES[stage - 1];
  const stageSince = dateKey(current.start_at, tz);
  const planSince = dateKey(run[0].start_at, tz);
  const fullDays = Math.max(0, daysBetween(stageSince, today) - 1);

  // The day the stage began is only part-way under it, so judging starts the day after.
  const firstJudged = addDays(stageSince, 1);
  const judgedDays: DateKey[] = [];
  for (let i = 1; i <= 7; i++) {
    const date = addDays(today, -i);
    if (date >= firstJudged) judgedDays.push(date);
  }
  const kept = judgedDays.filter((d) => keptDay(stage, sootherDay(input, habits, d, h))).length;
  const todayKept = stageSince < today ? keptDay(stage, sootherDay(input, habits, today, h)) : null;
  const suggestNext = stage < 4 && judgedDays.length >= WEAN_MIN_DAYS && kept >= WEAN_KEPT_OF_7;

  const since = daysBetween(stageSince, today);
  const began = since === 0 ? 'today' : since === 1 ? 'yesterday' : since < 7 ? weekdayName(stageSince) : `${since} days ago`;
  lines.push(`Stage ${stage} of 4: ${info.name}, since ${began}.`);
  lines.push(`Allowed: ${info.allowed}. A day counts as kept when ${info.rule}.`);
  if (judgedDays.length) lines.push(`Kept ${kept} of the last ${judgedDays.length} ${judgedDays.length === 1 ? 'day' : 'days'}.`);
  if (todayKept !== null) lines.push(todayKept ? 'Today so far: kept.' : 'Today so far: not kept.');
  if (stage < 4) {
    lines.push(
      suggestNext
        ? `Ready for stage ${stage + 1} when you are: ${kept} of the last 7 days were kept.`
        : `Stage ${stage + 1} is suggested after at least ${WEAN_MIN_DAYS} full days, with ${WEAN_KEPT_OF_7} of the last 7 kept.`
    );
  } else if (judgedDays.length && kept < judgedDays.length) {
    lines.push(
      `The soother was used on ${judgedDays.length - kept} of the last ${judgedDays.length} days. The CPS advice is not to give it back once it is gone.`
    );
  }

  const before = nightAverages(h, addDays(planSince, -14), planSince);
  const during = nightAverages(h, stageSince, today);
  if (before.nights >= 3 && during.nights >= 2) {
    if (before.settle !== null && during.settle !== null) {
      lines.push(
        `Falling asleep at night: ${dur(during.settle)} on average in this stage, against ${dur(before.settle)} in the 2 weeks before the plan.`
      );
    }
    if (before.wakings !== null && during.wakings !== null) {
      lines.push(
        `Night wakings: ${during.wakings.toFixed(1)} a night in this stage, against ${before.wakings.toFixed(1)} before the plan (${during.nights} and ${before.nights} nights).`
      );
    }
  } else {
    lines.push('Not enough nights yet to compare his sleep with before the plan.');
  }
  lines.push(age);

  return {
    active: true,
    stage,
    info,
    stageSince,
    planSince,
    fullDays,
    judged: judgedDays.length,
    kept,
    todayKept,
    suggestNext,
    before,
    during,
    lines: lines.map(tidy)
  };
}

// --- Against his sleep (History -> Before sleep) ------------------------------------------------

/**
 * Screens and the soother against his sleep, like the activity comparisons.
 * Screen comparisons use the nights since the first screen was logged; the
 * soother ones use only sleeps where it was answered. Unusual days are left out.
 */
export function habitEffects(input: EngineInput, habits: HabitLike[], days = 60): SleepEffect[] {
  const h = new History(input);
  const tz = h.tz;
  const today = h.today();
  const from = addDays(today, -days);
  const ended = (kind: 'night' | 'nap') =>
    h.sleeps.filter((s) => {
      const isKind = kind === 'night' ? s.kind === 'night' : s.kind !== 'night';
      if (!isKind || !s.asleep_at || !s.woke_at) return false;
      const date = dayOf(s, tz);
      return date >= from && date < today && !h.days.get(date)?.off_tag;
    });
  const effects: SleepEffect[] = [];

  const screens = sessions(habits, 'screen');
  if (screens.length) {
    const firstDay = dateKey(screens[0].start_at, tz);
    const nights = ended('night').filter((s) => dayOf(s, tz) >= firstDay);
    const bedOf = (s: SleepLike) => toMs(s.in_bed_at ?? s.asleep_at!);
    const close = compareSleeps(
      nights,
      (s) => overlaps(habits, 'screen', bedOf(s) - SCREEN_CLEAR_MIN * MINUTE, bedOf(s), input.now),
      'night',
      'screen_hour',
      'Screens in the hour before bed'
    );
    if (close) effects.push(close);
    const over = compareSleeps(
      nights,
      (s) => minutesOn(habits, 'screen', dayOf(s, tz), tz, input.now) > SCREEN_LIMIT_MIN,
      'night',
      'screen_over',
      'Over 1 hour of screens that day'
    );
    if (over) effects.push(over);
  }

  for (const kind of ['night', 'nap'] as const) {
    const answered = ended(kind).filter((s) => s.soother === true || s.soother === false);
    const soother = compareSleeps(answered, (s) => s.soother === true, kind, `soother_${kind}`, 'Went down with the soother');
    if (soother) effects.push(soother);
  }
  return effects;
}

// Wall-clock arithmetic in the household time zone. Everything the schedule
// says ("asleep by 20:15", "must be up at 07:00") is a wall-clock time on a
// local date, so it has to survive the daylight-saving changes. Kept free of
// browser APIs so the tests run in node.

export type Stamp = string | number | Date;

/** A local calendar date, 'YYYY-MM-DD'. */
export type DateKey = string;

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY_MIN = 24 * 60;

export function toMs(v: Stamp): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const parsed = Date.parse(v);
  if (Number.isNaN(parsed)) throw new Error(`bad timestamp: ${v}`);
  return parsed;
}

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

// Building a formatter is slow and the engine asks thousands of times, so keep one per zone.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function localParts(at: Stamp, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(new Date(toMs(at)));

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

/** Minutes the zone is ahead of UTC at that instant (Toronto: -240 in summer, -300 in winter). */
export function utcOffsetMin(at: Stamp, timeZone: string): number {
  return Math.round(offsetMs(toMs(at), timeZone) / MINUTE);
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

// --- Calendar dates -----------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

export function dateKey(at: Stamp, timeZone: string): DateKey {
  const p = localParts(at, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function parseKey(key: DateKey): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

export function addDays(key: DateKey, days: number): DateKey {
  const { year, month, day } = parseKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Whole calendar days from a to b. */
export function daysBetween(a: DateKey, b: DateKey): number {
  const x = parseKey(a);
  const y = parseKey(b);
  return Math.round(
    (Date.UTC(y.year, y.month - 1, y.day) - Date.UTC(x.year, x.month - 1, x.day)) / 86_400_000
  );
}

/** ISO weekday: Monday is 1, Sunday is 7. */
export function isoWeekday(key: DateKey): number {
  const { year, month, day } = parseKey(key);
  const d = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * The instant at a wall-clock offset from the local midnight that starts the
 * date. Minutes past 1440 roll into the next day, so "25:30" on the 8th is
 * 01:30 on the 9th, whatever the clocks did overnight.
 */
export function atMinutes(key: DateKey, minutes: number, timeZone: string): number {
  const { year, month, day } = parseKey(key);
  const whole = Math.round(minutes);
  const dayOffset = Math.floor(whole / DAY_MIN);
  const within = whole - dayOffset * DAY_MIN;
  return fromLocal(timeZone, year, month, day + dayOffset, Math.floor(within / 60), within % 60);
}

/** The wall-clock minutes of an instant, counted from the local midnight of the date. */
export function minutesOf(key: DateKey, at: Stamp, timeZone: string): number {
  const p = localParts(at, timeZone);
  const own = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  return daysBetween(key, own) * DAY_MIN + p.hour * 60 + p.minute + p.second / 60;
}

// --- Clock strings ('HH:MM', 24-hour, as stored) -----------------------------

export function parseClock(clock: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) throw new Error(`bad clock time: ${clock}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function clockString(minutes: number): string {
  const m = ((Math.round(minutes) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Whole months from birth to now, in the household zone. */
export function ageInMonths(birth: Stamp, now: Stamp, timeZone: string): number {
  const b = localParts(birth, timeZone);
  const n = localParts(now, timeZone);
  let months = (n.year - b.year) * 12 + (n.month - b.month);
  if (n.day < b.day) months -= 1;
  return Math.max(0, months);
}

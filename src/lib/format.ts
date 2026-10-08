// How times and durations read on screen and in notifications: 12-hour clock,
// Canadian style ("8:15 p.m."). Kept free of browser APIs for the tests.
import { DAY_MIN, dateKey, fromLocal, localParts, minutesOf, type Stamp } from './time';

/** "8:15 p.m." from wall-clock minutes past midnight (any day offset). */
export function clock12(minutes: number): string {
  const m = ((Math.round(minutes) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const suffix = h < 12 ? 'a.m.' : 'p.m.';
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${suffix}`;
}

/** "8:15 p.m." for an instant, in the household zone. */
export function clockAt(at: Stamp, timeZone: string): string {
  return clock12(minutesOf(dateKey(at, timeZone), at, timeZone));
}

/** A sentence that ends on "a.m." or "p.m." keeps a single full stop. */
export function tidy(text: string): string {
  return text.replace(/([ap]\.m)\.\./g, '$1.');
}

/** "45 min", "2 h", "1 h 05 min" */
export function dur(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} h`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** "3 h 12 min", "48 min", "just now" */
export function since(ms: number | null): string {
  if (ms === null) return '--';
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 1) return 'just now';
  return dur(mins);
}

export function dayLabel(at: Stamp, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(new Date(at));
}

/** "Thu, Oct 8" for a 'YYYY-MM-DD' date. */
export function keyLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** "March 15, 2024" for a 'YYYY-MM-DD' date. */
export function longDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', dateStyle: 'long' }).format(
    new Date(Date.UTC(y, m - 1, d, 12))
  );
}

/** "Sunday" for a 'YYYY-MM-DD' date. */
export function weekdayName(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'long' }).format(
    new Date(Date.UTC(y, m - 1, d, 12))
  );
}

/** For a datetime-local input, in the household zone. */
export function toLocalInput(at: Stamp, timeZone: string): string {
  const p = localParts(at, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** The instant a datetime-local value names, in the household zone. Empty gives null. */
export function fromLocalInput(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match.map(Number);
  return new Date(fromLocal(timeZone, y, m, d, hh, mm)).toISOString();
}

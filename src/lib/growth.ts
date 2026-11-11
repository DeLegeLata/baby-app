// Weight and height against the WHO Child Growth Standards for boys: his age on
// each measurement date, the z-score and percentile (WHO's LMS method), the
// percentile curves the charts draw, and the words the Growth tab shows.
import { WHO_BOYS_HEIGHT_CM, WHO_BOYS_WEIGHT_KG, type LmsRow } from './who-growth';
import { daysBetween, parseKey, type DateKey } from './time';

export type Measure = 'weight' | 'height';

/** The standards run from birth to 5 years (1856 days). */
export const WHO_LAST_DAY = 1856;
/** A month in days, for placing whole-month ages on the charts. */
export const MONTH_DAYS = 30.4375;

const TABLES: Record<Measure, readonly LmsRow[]> = { weight: WHO_BOYS_WEIGHT_KG, height: WHO_BOYS_HEIGHT_CM };

/** The curves on WHO's charts, with the z-score of each. */
export const CURVES = [
  { p: 3, z: -1.880794 },
  { p: 15, z: -1.036433 },
  { p: 50, z: 0 },
  { p: 85, z: 1.036433 },
  { p: 97, z: 1.880794 }
] as const;

/** L, M and S on an age in days, read in a straight line between the kept days. */
export function lmsAt(measure: Measure, day: number): LmsRow | null {
  if (!(day >= 0 && day <= WHO_LAST_DAY)) return null;
  const rows = TABLES[measure];
  let lo = 0;
  let hi = rows.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][0] <= day) lo = mid;
    else hi = mid;
  }
  const a = rows[lo];
  const b = rows[hi];
  if (day === a[0]) return a;
  if (day === b[0]) return b;
  const t = (day - a[0]) / (b[0] - a[0]);
  return [day, a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2]), a[3] + t * (b[3] - a[3])];
}

/** The measurement that sits at z standard deviations on this LMS row. */
export function valueAtZ([, L, M, S]: LmsRow, z: number): number {
  return Math.abs(L) < 1e-9 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L);
}

/**
 * The z-score of a measurement. Beyond 3 SD, WHO measures in steps of the
 * distance between the 2 and 3 SD lines instead, so an extreme weight is not
 * squeezed by the skew of the curve. Height has L = 1, where both agree.
 */
export function zScore(x: number, lms: LmsRow): number {
  const [, L, M, S] = lms;
  const z = Math.abs(L) < 1e-9 ? Math.log(x / M) / S : (Math.pow(x / M, L) - 1) / (L * S);
  if (z > 3) {
    const sd3 = valueAtZ(lms, 3);
    return 3 + (x - sd3) / (sd3 - valueAtZ(lms, 2));
  }
  if (z < -3) {
    const sd3 = valueAtZ(lms, -3);
    return -3 + (x - sd3) / (valueAtZ(lms, -2) - sd3);
  }
  return z;
}

/** The share of children below z, as a percentage (Abramowitz and Stegun 26.2.17). */
export function percentileOf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const tail = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 100 * (z > 0 ? 1 - tail : tail);
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "62nd", or "below the 1st" / "above the 99th" at the ends. */
export function percentileLabel(p: number): string {
  if (p < 1) return 'below the 1st';
  if (p > 99) return 'above the 99th';
  return ordinal(Math.round(p));
}

// --- Ages -------------------------------------------------------------------------

/** His birth date, from the stored birth_at ("YYYY-MM-DDT12:00:00.000Z"). */
export function birthKey(birth_at: string | null): DateKey | null {
  return birth_at ? birth_at.slice(0, 10) : null;
}

/** Whole calendar months from birth to a date. */
export function monthsBetween(birth: DateKey, on: DateKey): number {
  const b = parseKey(birth);
  const n = parseKey(on);
  let months = (n.year - b.year) * 12 + (n.month - b.month);
  if (n.day < b.day) months -= 1;
  return months;
}

/** "5 days", "6 weeks", "18 months", "2 years", "2 years 1 month". */
export function ageLabel(birth: DateKey, on: DateKey): string {
  const days = daysBetween(birth, on);
  if (days < 0) return 'before birth';
  if (days < 14) return days === 1 ? '1 day' : `${days} days`;
  const months = monthsBetween(birth, on);
  if (months < 3) return `${Math.floor(days / 7)} weeks`;
  if (months < 24) return `${months} months`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `${years} years${rest ? ` ${rest} ${rest === 1 ? 'month' : 'months'}` : ''}`;
}

/** A short age for an axis: "6m", "18m", "2y", "2y 6m". */
export function axisAge(months: number): string {
  if (months < 24) return `${months}m`;
  const rest = months % 12;
  return `${Math.floor(months / 12)}y${rest ? ` ${rest}m` : ''}`;
}

// --- Readings ---------------------------------------------------------------------

export type MeasureRow = { id: string; measured_on: DateKey; weight_g: number | null; height_mm: number | null };

export type Reading = {
  id: string;
  date: DateKey;
  /** age in days on the measurement date */
  day: number;
  /** kg or cm */
  value: number;
  /** null without a birth date, or outside birth to 5 years */
  z: number | null;
  p: number | null;
};

export const UNIT: Record<Measure, string> = { weight: 'kg', height: 'cm' };

export function valueOf(row: MeasureRow, measure: Measure): number | null {
  if (measure === 'weight') return row.weight_g === null ? null : row.weight_g / 1000;
  return row.height_mm === null ? null : row.height_mm / 10;
}

/** One measure's readings, oldest first, each placed against the standard for his age that day. */
export function readings(rows: MeasureRow[], birth: DateKey | null, measure: Measure): Reading[] {
  const out: Reading[] = [];
  for (const row of rows) {
    const value = valueOf(row, measure);
    if (value === null) continue;
    const day = birth ? daysBetween(birth, row.measured_on) : NaN;
    const lms = birth ? lmsAt(measure, day) : null;
    const z = lms ? zScore(value, lms) : null;
    out.push({ id: row.id, date: row.measured_on, day, value, z, p: z === null ? null : percentileOf(z) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** "12.4 kg", "87.5 cm". */
export function show(value: number, measure: Measure): string {
  const text = measure === 'weight' ? value.toFixed(2).replace(/0$/, '') : value.toFixed(1).replace(/\.0$/, '');
  return `${text} ${UNIT[measure]}`;
}

/** The same weight in pounds and ounces, or the height in feet and inches. */
export function imperial(value: number, measure: Measure): string {
  if (measure === 'weight') {
    let pounds = Math.floor(value / 0.45359237);
    let ounces = Math.round((value / 0.45359237 - pounds) * 16);
    if (ounces === 16) [pounds, ounces] = [pounds + 1, 0];
    return `${pounds} lb ${ounces} oz`;
  }
  const inches = Math.round((value / 2.54) * 2) / 2;
  const feet = Math.floor(inches / 12);
  const rest = inches - feet * 12;
  const half = rest % 1 ? '½' : '';
  return `${feet} ft ${Math.floor(rest)}${half} in`;
}

// --- The chart --------------------------------------------------------------------

export type ChartWindow = { from: number; to: number };

/**
 * The ages the chart spans, in days: the last year up to three months ahead of
 * today, widened back to the oldest measurement, and never past 5 years.
 */
export function chartWindow(nowDay: number, points: Reading[]): ChartWindow {
  const days = points.map((p) => p.day).filter((d) => d >= 0 && d <= WHO_LAST_DAY);
  const first = Math.min(nowDay - 365, ...days);
  const last = Math.max(nowDay, ...days);
  let from = Math.max(0, Math.floor(first / MONTH_DAYS) * MONTH_DAYS);
  let to = Math.min(WHO_LAST_DAY, Math.ceil((last + 91) / MONTH_DAYS) * MONTH_DAYS);
  if (to - from < 6 * MONTH_DAYS) from = Math.max(0, to - 6 * MONTH_DAYS);
  if (to <= from) to = Math.min(WHO_LAST_DAY, from + 6 * MONTH_DAYS);
  return { from: Math.round(from), to: Math.round(to) };
}

/** One percentile curve across the window, split where length gives way to standing height at 2. */
export function curve(measure: Measure, z: number, win: ChartWindow): { day: number; value: number }[][] {
  const pieces: { day: number; value: number }[][] = [];
  let piece: { day: number; value: number }[] = [];
  const step = Math.max(1, Math.round((win.to - win.from) / 120));
  const days: number[] = [];
  for (let d = win.from; d < win.to; d += step) days.push(d);
  days.push(win.to);
  if (measure === 'height' && win.from <= 730 && win.to >= 731) days.push(730, 731);
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  for (const day of sorted) {
    if (measure === 'height' && day === 731 && piece.length) {
      pieces.push(piece);
      piece = [];
    }
    const lms = lmsAt(measure, day);
    if (lms) piece.push({ day, value: valueAtZ(lms, z) });
  }
  if (piece.length) pieces.push(piece);
  return pieces;
}

/** Round steps for an axis: no more than `most` ticks between lo and hi. */
export function ticks(lo: number, hi: number, most = 6): number[] {
  const span = hi - lo;
  const step = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50].find((s) => span / s <= most) ?? 100;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** Whole-month ages for the x axis: every month, 3 months or 6 months, by the span. */
export function ageTicks(win: ChartWindow): number[] {
  // the window's ends are rounded to whole days, so a month within half a day of an end still counts
  const first = Math.ceil((win.from - 0.5) / MONTH_DAYS);
  const last = Math.floor((win.to + 0.5) / MONTH_DAYS);
  const span = last - first;
  const every = span <= 8 ? 1 : span <= 24 ? 3 : 6;
  const out: number[] = [];
  for (let m = Math.ceil(first / every) * every; m <= last; m += every) out.push(m);
  return out;
}

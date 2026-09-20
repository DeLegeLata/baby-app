import type { AppSettings } from './model';

/** "3h 12m", "48m", "just now" */
export function since(ms: number | null): string {
  if (ms === null) return '--';
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 1) return 'just now';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** "12:04" in the household time zone. */
export function clock(at: string | number | Date, settings: AppSettings): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.time_zone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(at));
}

export function dayLabel(at: string | number | Date, settings: AppSettings): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.time_zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(new Date(at));
}

export function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** For the datetime-local input, in the household time zone. */
export function toLocalInput(at: string, settings: AppSettings): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.time_zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

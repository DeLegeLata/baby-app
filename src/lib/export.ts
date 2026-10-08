// The CSV export: every sleep, one row each, times in the household zone.
import { dayOf, netSleepMinutes, wakingMinutes } from './engine';
import { toLocalInput } from './format';
import type { Sleep } from './model';

const COLUMNS = [
  'date',
  'kind',
  'in_bed',
  'asleep',
  'woke',
  'minutes_asleep',
  'night_wakings',
  'minutes_awake_in_night',
  'place',
  'mood',
  'note',
  'deleted'
];

function cell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function sleepsCsv(sleeps: Sleep[], timeZone: string, now = Date.now()): string {
  const local = (iso: string | null) => (iso ? toLocalInput(iso, timeZone).replace('T', ' ') : '');
  const rows = sleeps
    .filter((s) => s.asleep_at || s.in_bed_at)
    .sort((a, b) => Date.parse(a.asleep_at ?? a.in_bed_at!) - Date.parse(b.asleep_at ?? b.in_bed_at!))
    .map((s) => [
      dayOf(s, timeZone),
      s.kind,
      local(s.in_bed_at),
      local(s.asleep_at),
      local(s.woke_at),
      s.asleep_at ? Math.round(netSleepMinutes(s, now)) : '',
      s.wakings.length,
      Math.round(wakingMinutes(s, s.woke_at ? Date.parse(s.woke_at) : now)),
      s.place,
      s.mood,
      s.note,
      s.deleted_at ? 'yes' : ''
    ]);
  return [COLUMNS, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

/** Share sheet where the phone has one (iPhone home-screen app), else a download. */
export async function saveFile(name: string, text: string, type = 'text/csv') {
  const file = new File([text], name, { type });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

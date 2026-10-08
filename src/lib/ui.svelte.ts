// Which screen and which sheet are open. Any component can open a sheet.
import type { Sleep } from './model';
import type { DateKey } from './time';

export type SleepDraft = { id: string | null; preset: Partial<Sleep> };

class Ui {
  tab = $state<'today' | 'history'>('today');
  sleep = $state<SleepDraft | null>(null);
  day = $state<DateKey | null>(null);
  settings = $state(false);
  asleep = $state(false);
  report = $state(false);

  editSleep(id: string) {
    this.sleep = { id, preset: {} };
  }

  newSleep(preset: Partial<Sleep> = {}) {
    this.sleep = { id: null, preset };
  }
}

export const ui = new Ui();

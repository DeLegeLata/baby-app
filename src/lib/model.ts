// Entry shapes and settings. The columns mirror the Supabase tables in
// supabase/schema.sql, so an entry can be uploaded as-is.
import { z } from 'zod';
import { DEFAULT_SETTINGS, type Settings } from './rule';

export const SCHEMA_VERSION = 1;

export type Kind = 'feed' | 'diaper';
export type Side = 'left' | 'right';
export type FeedMethod = 'nursing' | 'bottle';
export type MilkType = 'breast' | 'formula';

export type Entry = {
  id: string;
  household_id: string;
  baby_id: string;
  kind: Kind;
  started_at: string;
  ended_at: string | null;
  logged_by: string;
  rev: number;
  updated_at: string;
  deleted_at: string | null;
  schema_version: number;
  epoch: number;
  // feeds
  feed_method: FeedMethod | null;
  left_sec: number | null;
  right_sec: number | null;
  last_side: Side | null;
  bottle_ml: number | null;
  milk_type: MilkType | null;
  // diapers
  wet: boolean | null;
  dirty: boolean | null;
  stool_color: number | null;
  note: string | null;
  // local only, never uploaded
  synced: 0 | 1;
};

export const UPLOAD_COLUMNS = [
  'id',
  'household_id',
  'baby_id',
  'kind',
  'started_at',
  'ended_at',
  'logged_by',
  'rev',
  'updated_at',
  'deleted_at',
  'schema_version',
  'epoch',
  'feed_method',
  'left_sec',
  'right_sec',
  'last_side',
  'bottle_ml',
  'milk_type',
  'wet',
  'dirty',
  'stool_color',
  'note'
] as const;

/** The row shape that goes to Supabase: an entry without its local-only fields. */
export type EntryRow = Omit<Entry, 'synced'>;

export function toRow(entry: Entry): EntryRow {
  const row = {} as Record<string, unknown>;
  for (const column of UPLOAD_COLUMNS) row[column] = entry[column];
  return row as EntryRow;
}

/** Expected diapers for a day of life. The last row covers every later day. */
export const expectedDiapersSchema = z.array(
  z.object({ day: z.number().int().min(1), wet: z.number().int().min(0), dirty: z.number().int().min(0) })
);

export const settingsSchema = z.object({
  // the timer rule
  target_min: z.number().int().positive(),
  max_gap_min: z.number().int().positive(),
  merge_gap_min: z.number().int().min(0),
  max_session_min: z.number().int().positive(),
  running_prompt_min: z.number().int().positive(),
  emergency_retry_min: z.number().int().positive(),
  emergency_max_min: z.number().int().positive(),
  back_to_birth_weight: z.boolean(),
  time_zone: z.string().min(1),
  // health, seeded from research 02 and 06; the doctor numbers overwrite them
  vitamin_d_iu: z.number().int().positive(),
  fever_c: z.number(),
  diaper_guide_days: z.number().int().positive(),
  expected_diapers: expectedDiapersSchema,
  flagged_stool_colors: z.array(z.number().int().min(1).max(9)),
  // household
  units: z.literal('ml')
});

export type AppSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  vitamin_d_iu: 400,
  fever_c: 38.0,
  diaper_guide_days: 14,
  expected_diapers: [
    { day: 1, wet: 1, dirty: 1 },
    { day: 2, wet: 2, dirty: 1 },
    { day: 3, wet: 3, dirty: 3 },
    { day: 4, wet: 4, dirty: 3 },
    { day: 5, wet: 6, dirty: 2 }
  ],
  flagged_stool_colors: [1, 2, 3, 4, 5, 6],
  units: 'ml'
};

/** The timer rule only needs its own fields. */
export function ruleSettings(settings: AppSettings): Settings {
  const {
    target_min,
    max_gap_min,
    merge_gap_min,
    max_session_min,
    running_prompt_min,
    emergency_retry_min,
    emergency_max_min,
    back_to_birth_weight,
    time_zone
  } = settings;
  return {
    target_min,
    max_gap_min,
    merge_gap_min,
    max_session_min,
    running_prompt_min,
    emergency_retry_min,
    emergency_max_min,
    back_to_birth_weight,
    time_zone
  };
}

export function expectedFor(settings: AppSettings, dayOfLife: number): { wet: number; dirty: number } | null {
  if (dayOfLife < 1 || dayOfLife > settings.diaper_guide_days) return null;
  const rows = [...settings.expected_diapers].sort((a, b) => a.day - b.day);
  let match = rows[0];
  for (const row of rows) if (row.day <= dayOfLife) match = row;
  return match ? { wet: match.wet, dirty: match.dirty } : null;
}

/** British Columbia stool colour card: 1-6 abnormal, 7-9 normal. */
export function stoolFlagged(settings: AppSettings, colour: number | null): boolean {
  return colour !== null && settings.flagged_stool_colors.includes(colour);
}

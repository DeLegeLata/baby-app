-- Run this in the Supabase SQL editor for the project.
-- Row-level security is keyed on household membership. Test B5 checks it with
-- both parents plus an outsider account.

create extension if not exists pgcrypto;

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  time_zone text not null default 'America/Toronto',
  settings jsonb not null default '{}'::jsonb,
  data_epoch integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists members (
  household_id uuid not null references households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  alert_channel text check (alert_channel in ('bark', 'ntfy')),
  alert_address text,
  last_seen_at timestamptz,
  primary key (household_id, user_id)
);

create table if not exists babies (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  name text not null,
  birth_at timestamptz,
  sex text,
  birth_weight_g integer
);

create table if not exists entries (
  id uuid primary key,
  household_id uuid not null references households (id) on delete cascade,
  baby_id uuid not null references babies (id) on delete cascade,
  kind text not null check (kind in ('feed', 'diaper')),
  started_at timestamptz not null,
  ended_at timestamptz,
  logged_by uuid not null,
  rev integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  schema_version integer not null default 1,
  epoch integer not null default 1,
  feed_method text check (feed_method in ('nursing', 'bottle')),
  left_sec integer,
  right_sec integer,
  last_side text check (last_side in ('left', 'right')),
  bottle_ml integer,
  milk_type text check (milk_type in ('breast', 'formula')),
  wet boolean,
  dirty boolean,
  stool_color integer check (stool_color between 1 and 9),
  note text
);

create index if not exists entries_household_started on entries (household_id, started_at desc);
create index if not exists entries_household_updated on entries (household_id, updated_at desc);

-- Slice 2 uses these; they are created now so the schema is in one place.
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  anchor_at timestamptz not null,
  type text not null check (type in ('target', 'max_gap')),
  first_sent_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  send_count integer not null default 1,
  recipients jsonb not null default '[]'::jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  stopped_at timestamptz,
  unique (household_id, anchor_at, type)
);

create table if not exists reminder_runs (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  outcome text not null,
  detail jsonb
);

-- --- Row-level security ------------------------------------------------------

create or replace function is_member (target uuid) returns boolean language sql stable security definer
set
  search_path = public as $$
  select exists (
    select 1 from members m
    where m.household_id = target and m.user_id = auth.uid()
  );
$$;

alter table households enable row level security;
alter table members enable row level security;
alter table babies enable row level security;
alter table entries enable row level security;
alter table alerts enable row level security;
alter table reminder_runs enable row level security;

drop policy if exists households_rw on households;
create policy households_rw on households for all using (is_member (id))
with
  check (is_member (id));

drop policy if exists members_read on members;
create policy members_read on members for select using (is_member (household_id));

drop policy if exists members_self_update on members;
create policy members_self_update on members
for update
  using (user_id = auth.uid ())
with
  check (user_id = auth.uid ());

drop policy if exists babies_rw on babies;
create policy babies_rw on babies for all using (is_member (household_id))
with
  check (is_member (household_id));

drop policy if exists entries_rw on entries;
create policy entries_rw on entries for all using (is_member (household_id))
with
  check (is_member (household_id));

drop policy if exists alerts_rw on alerts;
create policy alerts_rw on alerts for all using (is_member (household_id))
with
  check (is_member (household_id));

-- reminder_runs stays readable so the status card can show the last run.
drop policy if exists reminder_runs_read on reminder_runs;
create policy reminder_runs_read on reminder_runs for select using (auth.uid () is not null);

-- Realtime for the two phones.
alter publication supabase_realtime
add table entries;

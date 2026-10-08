-- The toddler sleep app, on top of schema.sql. Run it once in the Supabase SQL
-- editor of the existing project; running it again is harmless. The newborn
-- app's tables and rows (entries, alerts) are left exactly as they are.

-- --- The child -------------------------------------------------------------------
-- The toddler gets his own row in babies, marked by role. Name and birth date
-- are set from the app's Settings.

alter table babies add column if not exists role text not null default 'baby';
alter table babies drop constraint if exists babies_role_check;
alter table babies add constraint babies_role_check check (role in ('baby', 'toddler'));

insert into babies (household_id, name, role)
select h.id, 'Toddler', 'toddler'
from households h
where not exists (select 1 from babies b where b.household_id = h.id and b.role = 'toddler');

-- --- Sleeps ----------------------------------------------------------------------

create table if not exists sleeps (
  id uuid primary key,
  household_id uuid not null references households (id) on delete cascade,
  child_id uuid not null references babies (id) on delete cascade,
  kind text not null check (kind in ('night', 'nap', 'catnap')),
  in_bed_at timestamptz,
  asleep_at timestamptz,
  woke_at timestamptz,
  -- night wakings: [{ "start": iso, "end": iso | null }]
  wakings jsonb not null default '[]'::jsonb,
  place text check (place in ('bed', 'daycare', 'car', 'stroller', 'parents_bed', 'other')),
  mood text check (mood in ('happy', 'fine', 'grumpy')),
  note text,
  logged_by uuid not null,
  rev integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  schema_version integer not null default 1,
  check (asleep_at is not null or in_bed_at is not null)
);

create index if not exists sleeps_household_updated on sleeps (household_id, updated_at);
create index if not exists sleeps_household_asleep on sleeps (household_id, asleep_at desc);

-- --- Per-date changes and unusual days ---------------------------------------------
-- One row per child and date. The id is "<child id>:<date>", so both phones
-- address the same row.

create table if not exists days (
  id text primary key,
  household_id uuid not null references households (id) on delete cascade,
  child_id uuid not null references babies (id) on delete cascade,
  date date not null,
  override jsonb not null default '{}'::jsonb,
  off_tag text check (off_tag in ('sick', 'teething', 'travel', 'other')),
  no_nap boolean not null default false,
  note text,
  logged_by uuid not null,
  rev integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  schema_version integer not null default 1,
  unique (child_id, date)
);

create index if not exists days_household_updated on days (household_id, updated_at);

-- The server stamps updated_at, so the pull never misses a row because one
-- phone's clock runs behind the other's.
create or replace function stamp_updated_at () returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sleeps_stamp on sleeps;
create trigger sleeps_stamp before insert or update on sleeps
for each row execute function stamp_updated_at ();

drop trigger if exists days_stamp on days;
create trigger days_stamp before insert or update on days
for each row execute function stamp_updated_at ();

-- --- Reminders ------------------------------------------------------------------------
-- Each phone that turns reminders on adds its push subscription. The phones
-- write when each reminder is due; the send-reminders Edge Function sends it.

create table if not exists push_subscriptions (
  endpoint text primary key,
  household_id uuid not null references households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now()
);

create table if not exists planned_reminders (
  household_id uuid not null references households (id) on delete cascade,
  kind text not null check (kind in ('bedtime', 'wake', 'test')),
  for_date date not null,
  -- null means cancelled
  send_at timestamptz,
  title text not null default '',
  body text not null default '',
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (household_id, kind, for_date)
);

create index if not exists planned_reminders_due on planned_reminders (send_at)
where sent_at is null;

-- --- Row-level security ----------------------------------------------------------------

alter table sleeps enable row level security;
alter table days enable row level security;
alter table push_subscriptions enable row level security;
alter table planned_reminders enable row level security;

drop policy if exists sleeps_rw on sleeps;
create policy sleeps_rw on sleeps for all using (is_member (household_id))
with
  check (is_member (household_id));

drop policy if exists days_rw on days;
create policy days_rw on days for all using (is_member (household_id))
with
  check (is_member (household_id));

drop policy if exists push_subscriptions_rw on push_subscriptions;
create policy push_subscriptions_rw on push_subscriptions for all using (is_member (household_id))
with
  check (is_member (household_id) and user_id = auth.uid ());

drop policy if exists planned_reminders_rw on planned_reminders;
create policy planned_reminders_rw on planned_reminders for all using (is_member (household_id))
with
  check (is_member (household_id));

-- --- Realtime for the two phones ---------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table sleeps;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table days;
exception when duplicate_object then null;
end $$;

-- --- The reminder secret ---------------------------------------------------------------
-- pg_cron sends this with every call to send-reminders, and the function asks
-- the database whether it matches. It never has to be copied anywhere.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'reminder_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid ()::text || gen_random_uuid ()::text, '-', ''),
      'reminder_secret'
    );
  end if;
end $$;

create or replace function reminder_secret_ok (candidate text) returns boolean language sql stable security definer
set
  search_path = public as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'reminder_secret' and decrypted_secret = candidate
  );
$$;

revoke execute on function reminder_secret_ok (text) from public, anon, authenticated;
grant execute on function reminder_secret_ok (text) to service_role;

-- --- Check -------------------------------------------------------------------------------

select h.name as household, b.name as toddler, b.id as toddler_id
from households h
join babies b on b.household_id = h.id and b.role = 'toddler';

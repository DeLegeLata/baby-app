# Setup

The app runs with no backend: everything logs to the phone it is on. Sync and,
later, the reminders need a free Supabase project.

## 1. Run it locally

```bash
npm install
npm run dev     # http://localhost:5173/baby-app/
npm test        # the timer rule
npm run build   # production build into dist/
```

## 2. Create the Supabase project

1. Make a free project in the region closest to home. Keep the database password
   somewhere safe.
2. Open the SQL editor and run [`supabase/schema.sql`](supabase/schema.sql). It
   creates the tables, the row-level security policies and the realtime
   publication.
3. In Project Settings → API keys, copy the **publishable** key
   (`sb_publishable_...`). The secret key is not needed until the reminders are
   built, and it must never go in this repo.

## 3. Point the app at it

```bash
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. `.env.local` is
git-ignored. For the deployed build, the same two values go in the GitHub
Actions workflow as repository variables (not secrets: they end up in the
JavaScript either way, which is fine, since row-level security is what protects
the data).

## 4. Make the two accounts and the household

In Authentication → Users, add both parents with **Add user → Create new user**
and a password each. Tick "Auto Confirm User".

Then paste this into the SQL editor. It makes every account that exists a member
of the one household, so create both users first and run it after. Nothing has
to be copied by hand, and running it twice is harmless.

```sql
with
  home as (
    insert into households (name, time_zone)
    select 'Home', 'America/Toronto'
    where not exists (select 1 from households)
    returning id
  ),
  household as (select id from home union all select id from households limit 1),
  baby as (
    insert into babies (household_id, name)
    select household.id, 'Baby' from household
    where not exists (select 1 from babies)
    returning id
  )
insert into members (household_id, user_id, display_name)
select household.id, u.id, split_part(u.email, '@', 1)
from household
cross join auth.users u
on conflict do nothing;

-- check
select h.name, b.name as baby, count(m.*) as members
from households h
left join babies b on b.household_id = h.id
left join members m on m.household_id = h.id
group by 1, 2;
```

It should report one household, one baby and **2** members.

Then turn **off** new sign-ups in Authentication → Sign In / Providers, so the
two accounts are the only ones.

Signing in on a phone adopts that household and baby, and anything logged before
sign-in is re-pointed at them and uploaded.

## What is not built yet

Slice 2: the reminders and ack Edge Functions, the Bark and ntfy senders, the
status card, the healthchecks.io watchdog and the CSV export.

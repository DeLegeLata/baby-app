# Setup

A toddler sleep tracker: it logs his naps and nights, learns his pattern, and
recommends tonight's bedtime and tomorrow's wake-up within his daily schedule.

The app runs with no backend: everything logs to the phone it is on. Sync
between the two phones and the reminders need a free Supabase project.

**Already running the newborn version?** Skip to step 4b, then step 6. The
feed and diaper rows stay in the database untouched; the app no longer shows
them.

## 1. Run it locally

```bash
npm install
npm run dev     # http://localhost:5173/baby-app/
npm test        # the sleep engine and the time-zone rules
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

Create `.env.local` (it is git-ignored) with:

```bash
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_VAPID_PUBLIC_KEY=          # from step 6; leave empty until then
```

For the deployed build, the same values go in GitHub as repository variables
(Settings -> Secrets and variables -> Actions -> Variables), not secrets: they end
up in the JavaScript either way, which is fine, since row-level security is
what protects the data and the VAPID public key is meant to be public.

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

### 4b. Add the toddler

Paste [`supabase/toddler.sql`](supabase/toddler.sql) into the SQL editor and run
it. It adds the toddler's row (marked `role = 'toddler'`), the `sleeps` and
`days` tables, the reminder tables, their row-level security and realtime, and
a reminder secret kept in Supabase Vault. Running it twice is harmless. The
last query should list the household with its toddler.

Signing in on a phone adopts that household and toddler, and anything logged
before sign-in is re-pointed at them and uploaded.

### 4c. Enter his schedule

On either phone, open Settings and fill in his name, birth date (it picks the
sleep guideline for his age) and his daily schedule: the must-be-up time, the
daycare nap window, the latest bedtime, and any times he must stay awake, such
as the drive home. **The times shipped in the app are placeholders.** The
"starting points" are what the app assumes until about a week of logging
replaces them. Settings are shared with the other phone on save.

## 5. Keep the free project awake

Supabase pauses a free project after 7 days without activity. The
[`keepalive`](.github/workflows/keepalive.yml) workflow prevents that by calling
`keepalive()` from the end of `supabase/schema.sql` once a day, which overwrites
a single timestamp row. The workflow re-enables itself on every run, because
GitHub turns off scheduled workflows in a public repo after 60 days without a
commit. If the project is paused anyway, restore it from the Supabase dashboard
within 90 days.

## 6. Reminders on the phones

Each phone that turns reminders on gets a notification 30 minutes before the
bedtime routine (the lead time is in Settings), and one when it is time to wake
him in the morning. The phones work out the times and write them to
`planned_reminders`; the `send-reminders` Edge Function, called once a minute by
`pg_cron`, sends whatever has fallen due as a standard web push. No extra app
is needed on either phone.

1. **Make the VAPID keys** (once, on any computer with Node):

   ```bash
   npx web-push generate-vapid-keys
   ```

   The public key goes in `.env.local` and in the GitHub repository variable
   `VITE_VAPID_PUBLIC_KEY`. The private key goes only into Supabase, below.

2. **Deploy the function.** In the dashboard: Edge Functions -> Deploy a new
   function -> Via editor. Name it `send-reminders`, paste
   [`supabase/functions/send-reminders/index.ts`](supabase/functions/send-reminders/index.ts),
   and turn **off** "Verify JWT" (the function checks the reminder secret
   instead). With the CLI it is
   `supabase functions deploy send-reminders --no-verify-jwt`.

3. **Give it its secrets** (Edge Functions -> Secrets):
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` set to
   `mailto:` and an address you read. If the function's log says it has no
   service key, add `SERVICE_KEY` with the project's secret key
   (`sb_secret_...`).

4. **Schedule it.** Put the project URL into
   [`supabase/reminders.sql`](supabase/reminders.sql) where it says, and run it
   in the SQL editor. Its last query shows the most recent calls; after a minute
   or two they should return status 200.

5. **On each phone**, push the new build (the GitHub Pages deploy picks up the
   new variable), then:
   - iPhone: open the site in Safari, Share -> Add to Home Screen, and open it
     from the home screen. Web push on an iPhone works only from there
     (iOS 16.4 or later).
   - Android: open it in Chrome; installing it is optional.

   Then Settings -> Turn on reminders -> allow notifications -> Send a test. The
   test reaches every phone with reminders on within a minute.

A reminder more than 20 minutes overdue is dropped rather than sent late, so a
phone that was offline does not get a stale bedtime alert. Sent reminders are
recorded in `reminder_runs`.

## How the predictions work

The engine is [`src/lib/engine.ts`](src/lib/engine.ts); its rules are tested in
`src/lib/engine.test.ts`, and every recommendation in the app has a "Why this
time?" list showing each step.

- **His usual bedtime** starts from the starting point in Settings and is
  learned from the last 28 days, a day's weight halving each week, so recent
  days count most. Days marked unusual (sick, teething, travel) are left out.
  Each logged bedtime is first read back to what it would have been after a
  normal nap, so a run of short naps does not drag the usual bedtime down.
- **Today's nap** moves bedtime: half the difference when the nap ends earlier
  or later than usual, a quarter of any shortfall in day sleep, half the usual
  nap (at most 90 minutes) when there was no nap, and a little later for a
  catnap after the nap. Until the daycare report is in, the app assumes the
  nap took the daycare window, and says so.
- **The schedule** then applies: never past the latest bedtime, early enough
  for his usual night before tomorrow's must-be-up, and clear of the times he
  must stay awake. There is no earliest bedtime.
- **Clock changes.** When the clocks go back (1 November 2026), bedtime starts
  45 minutes early that Sunday and eases back 15 minutes a night. When they go
  forward (14 March 2027), bedtime moves 15 minutes earlier on each of the four
  nights before. Both plans only ever move bedtime earlier, so they never
  collide with the latest bedtime or the must-be-up time.
- **The morning wake** is once he has had his usual night (plus any time awake
  in the night), never before his usual wake time and never after the
  must-be-up time.
- **The guideline** for his age is the Canadian 24-Hour Movement Guidelines for
  the Early Years: 11 to 14 hours in 24 hours for ages 1 and 2, 10 to 13 for
  ages 3 and 4, naps included.

The numbers (the shares, the half-life, the window widths) are in `TUNING` at
the top of the engine.

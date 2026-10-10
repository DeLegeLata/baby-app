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
```

For the deployed build, the same two values go in GitHub as repository variables
(Settings -> Secrets and variables -> Actions -> Variables), not secrets: they end
up in the JavaScript either way, which is fine, since row-level security is
what protects the data.

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

The SQL editor runs SQL, not file names: open
[`supabase/toddler.sql`](supabase/toddler.sql) on GitHub, use **Copy raw file**
(the two-squares button above the code), paste it into a new query in the SQL
editor, and run it. It adds the toddler's row (marked `role = 'toddler'`), the
`sleeps`, `days` and `baths` tables, the reminder tables, their row-level
security and realtime, and a reminder secret kept in Supabase Vault. Running it
again is harmless, and is how a later version of the file is applied: after an
update, paste and run it once more. The last query should list the household
with its toddler.

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
bedtime routine (the lead time is in Settings), one when it is time to wake him
in the morning, and one on a day a bath is due (at the time set in Settings).
The phones work out the times and write them to `planned_reminders`; the
`send-reminders` Edge Function, called once a minute by `pg_cron`, sends
whatever has fallen due as a standard web push. No extra app is needed on
either phone, and there are no keys to make or copy: the function creates the
keys that sign the notifications on its first run and keeps them in
`push_keys`, and the phones fetch the public half from there.

1. **Run the latest `supabase/toddler.sql`** (step 4b) if it has changed since
   you last ran it.

2. **Deploy the function.** In the Supabase dashboard: Edge Functions -> Deploy
   a new function -> Via editor. Name it exactly `send-reminders`, replace the
   sample code with all of
   [`supabase/functions/send-reminders/index.ts`](supabase/functions/send-reminders/index.ts)
   (Copy raw file, as in step 4b), and deploy. Then open the function's
   settings and turn **off** JWT verification (labelled "Verify JWT" or
   "Enforce JWT verification"): pg_cron calls it with the reminder secret
   instead. With the CLI it is
   `supabase functions deploy send-reminders --no-verify-jwt`.

3. **Schedule it.** Copy [`supabase/reminders.sql`](supabase/reminders.sql)
   into a new SQL query, replace `https://YOUR-PROJECT-REF.supabase.co` with
   your project URL (Project Settings -> Data API -> Project URL), and run it.
   Wait a minute or two and run its last query again: the calls should show
   status 200. The first call also creates the keys.

4. **On each phone**, open the app from the home screen (see "On the phones"
   below), sign in, then Settings -> Turn on reminders -> allow notifications ->
   Send a test. The test reaches every phone with reminders on within a minute.

If the function's log says it has no service key, add an Edge Function secret
named `SERVICE_KEY` holding the project's secret key (`sb_secret_...`). If you
prefer your own VAPID keys, set the secrets `VAPID_PUBLIC_KEY` and
`VAPID_PRIVATE_KEY` and the GitHub variable `VITE_VAPID_PUBLIC_KEY` together;
they then replace the stored ones. Never delete the `push_keys` row once phones
have subscribed: their subscriptions are tied to it.

A reminder more than 20 minutes overdue is dropped rather than sent late, so a
phone that was offline does not get a stale bedtime alert. Sent reminders are
recorded in `reminder_runs`.

## On the phones

The app lives at **https://delegelata.github.io/baby-app/** and installs from
the browser; there is no app store step.

- **iPhone:** open that address in **Safari** (not another browser), tap the
  Share button, then **Add to Home Screen**, then **Add**. Open it from the new
  home-screen icon from then on: notifications on an iPhone work only from the
  home-screen app (iOS 16.4 or later).
- **Android:** open the address in **Chrome**, tap the three-dot menu, then
  **Add to Home screen** (or **Install app**), then **Install**.

Then sign in with that parent's email and password from step 4. Each phone keeps
working with no signal and catches up when it reconnects. A new version arrives
on its own the next time the app is opened; if one ever seems stuck, close the
app fully and open it again.

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

## Daily use

- **Put to bed** means into the crib, not asleep yet; **Fell asleep** is when he
  is actually asleep. Tapped straight from awake (the car, the stroller), Fell
  asleep asks what kind of sleep it is and where.
- **The nap card** (every day, under the status) holds today's nap. On a
  daycare day it is headed Daycare and holds the daycare nap; on any other day
  it is headed Nap and holds his nap at home. Times that are still to come are
  saved as the day's plan (say daycare naps at 1:00 today); times already past
  are saved as the nap itself, from their report at pickup or from what you saw
  at home. Either way tonight's bedtime moves at once, and the card shows it.
  At home, a plan with no real times an hour after it should have ended counts
  as no nap. "He did not nap" sits on the same card with an undo, and so does
  "No daycare today" on a daycare day. While he is in bed or asleep the card
  only says so, and the times come back once he is up. Change today and Change
  tomorrow cover everything else for a single date.
- **Add a sleep from earlier** (on the Today card, and Add under History) is for
  sleeps not logged at the time.

## Before sleep, and baths

- **Before this sleep.** While he is in bed or asleep, the Today screen shows a
  drop-down of activities (park or outdoors, active play, quiet play, TV or
  screen, snack or milk, bath, books, songs or music, car ride); any sleep can
  also be given them when it is edited. History -> Before sleep then compares,
  for each activity, the nights with it against the nights without it: how
  quickly he fell asleep (in bed to asleep), night wakings, and time asleep.
  Only nights where at least one activity was recorded count, unusual days are
  left out, the last 60 days are used, and a comparison appears once there are
  at least 3 nights each way. The engine is `activityEffects` in
  `src/lib/engine.ts`.
- **Baths.** The Bath card on the Today screen records baths and says when the
  next is due; a "Bath" chosen before a sleep counts too (once, if the same bath
  was also logged). The interval defaults to every 3 days, in line with general
  paediatric and dermatology guidance of two or three baths a week for
  toddlers, plus one after a messy day. Settings holds the interval and the
  reminder time (empty for no reminder).


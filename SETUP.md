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
and a password each. Then, in the SQL editor:

```sql
insert into households (name, time_zone) values ('Home', 'America/Toronto')
returning id;
-- use that id below
insert into babies (household_id, name) values ('<household-id>', 'Baby');
insert into members (household_id, user_id, display_name)
values ('<household-id>', '<user-id-1>', 'Parent 1'),
       ('<household-id>', '<user-id-2>', 'Parent 2');
```

Then turn **off** new sign-ups in Authentication → Sign In / Providers, so the
two accounts are the only ones.

Signing in on a phone adopts that household and baby, and anything logged before
sign-in is re-pointed at them and uploaded.

## What is not built yet

Slice 2: the reminders and ack Edge Functions, the Bark and ntfy senders, the
status card, the healthchecks.io watchdog and the CSV export.

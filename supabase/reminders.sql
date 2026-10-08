-- Run this after the send-reminders Edge Function is deployed (SETUP.md, step 6).
-- It calls the function once a minute. Put your project URL on the line below
-- first: Project Settings -> Data API -> Project URL. Running it again is harmless.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  url text := 'https://YOUR-PROJECT-REF.supabase.co'; -- <- your project URL
  existing uuid;
begin
  if url like '%YOUR-PROJECT-REF%' then
    raise exception 'Put your project URL in reminders.sql before running it';
  end if;
  select id into existing from vault.secrets where name = 'project_url';
  if existing is null then
    perform vault.create_secret(url, 'project_url');
  else
    perform vault.update_secret(existing, url);
  end if;
end $$;

-- Scheduling under the same name replaces the job, so this is safe to re-run.
select
  cron.schedule(
    'send-reminders',
    '* * * * *',
    $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
        || '/functions/v1/send-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-reminder-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 15000
    );
    $$
  );

-- Check: the job is there, and (after a minute or two) its calls succeed.
select jobname, schedule, active from cron.job where jobname = 'send-reminders';
select status_code, content::text, created
from net._http_response
order by created desc
limit 5;

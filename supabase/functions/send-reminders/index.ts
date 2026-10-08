// send-reminders: pg_cron calls this once a minute (supabase/reminders.sql).
// It sends every planned reminder that has fallen due to every phone in the
// household that turned reminders on, then marks it sent. A reminder more than
// 20 minutes overdue is dropped rather than sent late.
//
// Deploy with JWT verification off; the request is checked against the
// reminder secret in the database instead. Secrets the function needs:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (a mailto: address)
//   SERVICE_KEY, only if SUPABASE_SERVICE_ROLE_KEY is not provided automatically
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const STALE_MIN = 20;

const url = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:reminders@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
);

type Reminder = {
  household_id: string;
  kind: string;
  for_date: string;
  send_at: string;
  title: string;
  body: string;
};

type Subscription = { endpoint: string; p256dh: string; auth: string };

Deno.serve(async (req) => {
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: allowed, error: secretError } = await db.rpc('reminder_secret_ok', {
    candidate: req.headers.get('x-reminder-secret') ?? ''
  });
  if (secretError) return Response.json({ error: secretError.message }, { status: 500 });
  if (allowed !== true) return new Response('forbidden', { status: 403 });

  const now = new Date();
  const { data: due, error } = await db
    .from('planned_reminders')
    .select('*')
    .is('sent_at', null)
    .not('send_at', 'is', null)
    .lte('send_at', now.toISOString())
    .gte('send_at', new Date(now.getTime() - STALE_MIN * 60_000).toISOString());
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (const r of (due ?? []) as Reminder[]) {
    // Claim it first, so an overlapping run can never send it twice.
    const { data: claimed } = await db
      .from('planned_reminders')
      .update({ sent_at: now.toISOString() })
      .eq('household_id', r.household_id)
      .eq('kind', r.kind)
      .eq('for_date', r.for_date)
      .is('sent_at', null)
      .select('kind');
    if (!claimed?.length) continue;

    const { data: subs } = await db
      .from('push_subscriptions')
      .select('endpoint,p256dh,auth')
      .eq('household_id', r.household_id);

    const payload = JSON.stringify({ title: r.title, body: r.body, tag: `${r.kind}-${r.for_date}` });
    for (const s of (subs ?? []) as Subscription[]) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: STALE_MIN * 60, urgency: 'high' }
        );
        sent += 1;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The phone dropped the subscription (app removed, or reinstalled).
          await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
          removed += 1;
        } else {
          failed += 1;
          console.error('push failed', status, (e as Error).message);
        }
      }
    }
  }

  const result = { due: due?.length ?? 0, sent, failed, removed };
  if (result.due) await db.from('reminder_runs').insert({ outcome: failed ? 'partial' : 'ok', detail: result });
  return Response.json(result);
});

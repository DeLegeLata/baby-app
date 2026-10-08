// Phone notifications, the phone's half. The phone works out when each
// reminder is due (it already holds the whole sleep picture) and writes the
// time to planned_reminders; the send-reminders Edge Function, run every
// minute by pg_cron, sends whatever has fallen due to every subscribed phone in
// the household. Both phones compute the same times from the same synced data.
import type { PlannedReminder } from './engine';
import { supabase } from './supabase';

// The public half of the key that signs the notifications. Normally the phones
// ask Supabase for it (push_public_key(), filled in by send-reminders on its
// first run); a build variable can supply it instead.
const BUILD_VAPID = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || undefined;

export type PushStatus =
  | 'unconfigured' // this build has no Supabase project
  | 'unsupported' // the browser cannot do web push
  | 'needs-install' // an iPhone: web push only works from the home-screen app
  | 'blocked' // the person said no
  | 'off'
  | 'on';

export function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export async function pushStatus(): Promise<PushStatus> {
  if (!supabase) return 'unconfigured';
  if (isIos() && !isStandalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function publicKey(): Promise<string> {
  if (BUILD_VAPID) return BUILD_VAPID;
  const { data, error } = await supabase!.rpc('push_public_key');
  if (error) throw error;
  if (typeof data !== 'string' || !data) {
    throw new Error(
      'Reminders are not switched on in Supabase yet. Finish SETUP.md, step 6, wait a minute for the first run, then try again.'
    );
  }
  return data;
}

/** Must run from a tap: the iPhone only asks for permission in response to one. */
export async function enablePush(householdId: string, userId: string): Promise<void> {
  if (!supabase) throw new Error('This build has no Supabase project, so reminders cannot work.');
  // The permission prompt comes first, while the tap still counts: an iPhone
  // only shows it in direct response to one.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications are turned off for this app. Allow them in the phone settings, then try again.');
  }
  const key = await publicKey();
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      endpoint: json.endpoint,
      household_id: householdId,
      user_id: userId,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      device: navigator.userAgent.slice(0, 200)
    },
    { onConflict: 'endpoint' }
  );
  if (error) throw error;
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase?.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/** Ask the server for a test notification to every phone, within the minute. */
export async function sendTest(householdId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('planned_reminders').upsert(
    {
      household_id: householdId,
      kind: 'test',
      for_date: new Date().toISOString().slice(0, 10),
      send_at: new Date().toISOString(),
      title: 'Test reminder',
      body: 'Reminders reach this phone.',
      sent_at: null,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'household_id,kind,for_date' }
  );
  if (error) throw error;
}

// Only write when a reminder actually changes, to the minute.
const written = new Map<string, string>();

export async function writeReminders(householdId: string, planned: PlannedReminder[]): Promise<void> {
  if (!supabase) return;
  for (const r of planned) {
    const sendAt = r.sendAt === null ? null : new Date(Math.floor(r.sendAt / 60_000) * 60_000).toISOString();
    const key = `${r.kind}:${r.date}`;
    const signature = `${sendAt}|${r.title}|${r.body}`;
    if (written.get(key) === signature) continue;
    const { error } = await supabase.from('planned_reminders').upsert(
      {
        household_id: householdId,
        kind: r.kind,
        for_date: r.date,
        send_at: sendAt,
        title: r.title,
        body: r.body,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'household_id,kind,for_date' }
    );
    if (error) throw error;
    written.set(key, signature);
  }
}

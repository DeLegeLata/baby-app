// Loaded into the generated service worker (vite.config.ts, importScripts).
// Shows the reminders the send-reminders function pushes, and opens the app
// when one is tapped.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Sleep', {
      body: data.body || '',
      tag: data.tag,
      data: { tag: data.tag },
      renotify: Boolean(data.tag),
      icon: 'icon-192.png',
      badge: 'icon-192.png'
    })
  );
});

// A nudge to log the wake-up or the nap ("log_nap-2026-11-14") opens the app
// where that is entered; App.svelte does the opening.
function nudgeOf(tag) {
  const m = /^(log_wake|log_nap)-(\d{4}-\d{2}-\d{2})$/.exec(tag || '');
  return m ? { kind: m[1], date: m[2] } : null;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const open = nudgeOf((event.notification.data && event.notification.data.tag) || event.notification.tag);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          if (open) client.postMessage({ open });
          return;
        }
      }
      const url = new URL(self.registration.scope);
      if (open) {
        url.searchParams.set('open', open.kind);
        url.searchParams.set('date', open.date);
      }
      return self.clients.openWindow(url.href);
    })()
  );
});

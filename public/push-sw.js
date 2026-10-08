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
      renotify: Boolean(data.tag),
      icon: 'icon-192.png',
      badge: 'icon-192.png'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of open) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(self.registration.scope);
    })()
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Service Worker — Trade Moreira PWA
// ═══════════════════════════════════════════════════════════════════════════════
// Handles push notifications for Radar opportunities and basic offline caching.
// ═══════════════════════════════════════════════════════════════════════════════

const CACHE_NAME = 'trademoreira-v1';

// Assets to pre-cache for offline shell
const PRECACHE_URLS = [
  '/',
  '/radar',
  '/favicon.svg',
];

// ─── Install: pre-cache shell ───
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: clean old caches ───
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch: network-first, fallback to cache ───
self.addEventListener('fetch', (event) => {
  // Skip non-GET and API calls
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api') || url.hostname !== location.hostname) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ─── Push Notification: display when received ───
self.addEventListener('push', (event) => {
  let data = { title: '📡 Trade Moreira', body: 'Nova oportunidade no Radar!' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    vibrate: [200, 100, 200],
    tag: data.tag || 'radar-alert',
    data: { url: data.url || '/radar' },
    actions: [
      { action: 'open', title: 'Ver no Radar' },
      { action: 'dismiss', title: 'Dispensar' },
    ],
    requireInteraction: true, // Keep notification visible until user acts
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ─── Notification Click: open the app ───
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const urlToOpen = event.notification.data?.url || '/radar';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        // If app is already open, focus it
        for (const client of clients) {
          if (client.url.includes('/radar') && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise, open a new window
        return self.clients.openWindow(urlToOpen);
      })
  );
});

/* ============================================================
   Nova Kiosk Service Worker — v35.0
   - Caches kiosk.html shell + widget assets for offline use
   - Queues failed chat POSTs and retries on reconnect
   - Does NOT cache /api/chat responses (always fresh)
   - Bypasses auth-protected endpoints
   ============================================================ */

const CACHE_NAME = 'nova-kiosk-v35.0';
const SHELL_ASSETS = [
  '/kiosk',
  '/widget.js',
  '/avatars.js',
  '/widget-config.js'
];

// Install — pre-cache the kiosk shell
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
  );
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// In-memory message queue for offline chat POSTs
let messageQueue = [];

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'QUEUE_MESSAGE') {
    messageQueue.push(event.data.payload);
    event.source.postMessage({ type: 'QUEUED', count: messageQueue.length });
  }
  if (event.data && event.data.type === 'FLUSH_QUEUE') {
    flushQueue(event.source);
  }
});

async function flushQueue(client) {
  if (messageQueue.length === 0) return;
  const failed = [];
  while (messageQueue.length > 0) {
    const payload = messageQueue.shift();
    try {
      const r = await fetch('/api/chat', payload.fetchOptions);
      if (!r.ok) failed.push(payload);
      else if (client) client.postMessage({ type: 'DELIVERED', text: payload.text });
    } catch (err) {
      failed.push(payload);
    }
  }
  // Re-queue any that failed
  messageQueue = failed;
  if (client) client.postMessage({ type: 'FLUSH_DONE', remaining: failed.length });
}

// Fetch strategy:
// - GET /kiosk, /widget.js, /avatars.js → cache-first (instant load)
// - GET /api/widget/config/* → network-first (need latest branding)
// - GET /api/catalog/images/* → cache-first (images don't change often)
// - POST /api/chat → network-only; if fails, queue for retry
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Skip non-GET, non-POST (OPTIONS preflight etc.)
  if (req.method !== 'GET' && req.method !== 'POST') return;

  // POST /api/chat — network only, queue on failure
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    event.respondWith((async () => {
      try {
        const response = await fetch(req);
        return response;
      } catch (err) {
        // Network failed — queue the message for later delivery
        try {
          const body = await req.clone().json();
          messageQueue.push({
            text: body.text,
            fetchOptions: {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body)
            }
          });
          // Return a synthetic "queued" response so the UI can show "will retry"
          return new Response(JSON.stringify({
            ok: false,
            queued: true,
            error: 'You appear to be offline. Your message will be delivered when the connection returns.'
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        } catch {
          return new Response(JSON.stringify({ ok: false, error: 'Network error' }), {
            status: 503,
            headers: { 'content-type': 'application/json' }
          });
        }
      }
    })());
    return;
  }

  // GET requests — apply caching strategy
  if (req.method === 'GET') {
    // Kiosk shell — cache-first
    if (url.pathname === '/kiosk' || url.pathname.startsWith('/kiosk/')) {
      event.respondWith(
        caches.match(req).then((cached) => cached || fetch(req).then((r) => {
          const copy = r.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return r;
        }).catch(() => caches.match('/kiosk')))
      );
      return;
    }

    // Widget assets — cache-first
    if (['/widget.js', '/avatars.js', '/widget-config.js'].includes(url.pathname)) {
      event.respondWith(
        caches.match(req).then((cached) => cached || fetch(req).then((r) => {
          const copy = r.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return r;
        }))
      );
      return;
    }

    // Product images — cache-first, long TTL
    if (url.pathname.startsWith('/api/catalog/images/')) {
      event.respondWith(
        caches.match(req).then((cached) => cached || fetch(req).then((r) => {
          const copy = r.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return r;
        }).catch(() => new Response('', { status: 404 })))
      );
      return;
    }

    // Voice samples — cache-first
    if (url.pathname.startsWith('/api/voice/sample/')) {
      event.respondWith(
        caches.match(req).then((cached) => cached || fetch(req).then((r) => {
          const copy = r.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return r;
        }).catch(() => new Response('', { status: 404 })))
      );
      return;
    }

    // Widget config — network-first, fall back to cache
    if (url.pathname.startsWith('/api/widget/config/')) {
      event.respondWith(
        fetch(req).then((r) => {
          const copy = r.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return r;
        }).catch(() => caches.match(req))
      );
      return;
    }
  }
});

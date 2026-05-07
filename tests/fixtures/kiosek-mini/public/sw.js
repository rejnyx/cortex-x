// fixture: minimal service worker stub for offline-first kiosek detection
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

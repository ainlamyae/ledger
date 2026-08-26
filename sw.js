// Retired. The app no longer uses a service worker: this one cached the page's
// scripts and served them ahead of the network, while section-page.js always
// fetches index.html fresh — so every update ran new markup against old
// scripts. Browsers re-check this file on each visit, so a browser that still
// has the old worker installed picks this one up, which deletes every cache,
// unregisters itself, and reloads its open tabs straight from the server.
// index.html no longer registers it; keep the file so old installs can clean up.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) => client.navigate(client.url));
  })());
});

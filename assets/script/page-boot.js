// index.html's start-up, before first paint (after theme-boot.js).

// Always start at the top: panels re-render fresh on every load.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// Widgets and Bulbs start hidden unless this browser last had them on, so a row
// turned off doesn't flash before the Settings tab loads (app.js's SWITCHES_KEY).
try {
    var ledgerSwitches = JSON.parse(localStorage.getItem('ledger_switches') || 'null');
    if (!(ledgerSwitches && ledgerSwitches.SHOW_WIDGETS === 1)) {
        document.documentElement.setAttribute('data-widgets-pref', 'hidden');
    }
    // Main page only: section pages run this too.
    if (!window.ledgerSectionPage && !(ledgerSwitches && ledgerSwitches.SHOW_BULBS === 1)) {
        document.documentElement.setAttribute('data-bulbs-pref', 'hidden');
    }
} catch (e) {}

// The hub/page layout before first paint; page-nav.js and router.js fill in the rest.
if (!window.ledgerSectionPage) {
    document.documentElement.classList.add('home-hub');
} else {
    document.documentElement.classList.add('section-pages');
    document.documentElement.dataset.page = window.ledgerSectionPage.route.length ? 'block' : 'hub';
}

// No service worker any more: remove one a browser still has, with its cache,
// and reload once so the page comes straight from the server (sw.js does the same).
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(async (registrations) => {
        if (!registrations.length) return;
        await Promise.all(registrations.map((reg) => reg.unregister()));
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((key) => caches.delete(key)));
        }
        window.location.reload();
    }).catch(() => {});
}

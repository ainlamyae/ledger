// App-shell-only offline support: caches the static HTML/CSS/JS that make up
// the page itself, so it loads instantly (and works offline) — never the
// user's live Google Sheets data, which always has to come from the network.
// Bump this whenever the shell file list below changes — there's no build
// step to hash filenames automatically, so it's a manual, deliberate signal
// to evict the old cache rather than silently keep serving stale files.
const CACHE_NAME = 'ledger-shell-v2';

// Every same-origin file the app needs to boot and render its shell. Kept as
// an explicit list rather than parsed from index.html at install time —
// simpler and more robust than regex-scraping HTML inside a service worker.
// Deliberately excludes CDN scripts (Chart.js, chartjs-chart-geo): those are
// cross-origin and out of scope for "app shell only".
const SHELL_URLS = [
  '.',
  'index.html',
  'health/',
  'health/index.html',
  'finance/',
  'finance/index.html',
  'other/',
  'other/index.html',
  'manifest.json',
  'favicon.svg',
  'assets/images/apple-touch-icon.png',
  'assets/style/styles.css',
  'assets/script/config.js',
  'assets/script/auth.js',
  'assets/script/drive.js',
  'assets/script/sheets.js',
  'assets/script/cache.js',
  'assets/script/ui-helpers.js',
  'assets/script/groq.js',
  'assets/script/usda.js',
  'assets/script/nutrient-targets.js',
  'assets/script/nutrition.js',
  'assets/script/calorie-estimator.js',
  'assets/script/widgets.js',
  'assets/script/charts-base.js',
  'assets/script/wellness-math.js',
  'assets/script/wellness-charts.js',
  'assets/script/finance-charts.js',
  'assets/script/timesheet-charts.js',
  'assets/script/travel-charts.js',
  'assets/script/transactions.js',
  'assets/script/accounts.js',
  'assets/script/breakdown.js',
  'assets/script/timesheet.js',
  'assets/script/csv.js',
  'assets/script/activities.js',
  'assets/script/physique.js',
  'assets/script/physique-breakdown.js',
  'assets/script/strength-plan.js',
  'assets/script/activity-estimator.js',
  'assets/script/contacts.js',
  'assets/script/settings-panel.js',
  'assets/script/travel.js',
  'assets/script/applications.js',
  'assets/script/insight.js',
  'assets/script/food-insight.js',
  'assets/script/micronutrient-insight.js',
  'assets/script/activity-insight.js',
  'assets/script/protein-source-rotation-insight.js',
  'assets/script/plan-insight.js',
  'assets/script/insight-panel.js',
  'assets/script/formula-fields.js',
  'assets/script/formula-render.js',
  'assets/script/formula-playground.js',
  'assets/script/protein-rotation.js',
  'assets/script/financial-insight.js',
  'assets/script/gate.js',
  'assets/script/app.js',
  'assets/script/section-page.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Same-origin GET only — every Sheets/Drive/auth/USDA/Groq/weather/prayer-time
// request is cross-origin and left completely untouched here, so it always
// hits the network live. Stale-while-revalidate for the shell: answer from
// cache immediately when there is one (instant, works offline), while always
// re-fetching in the background to keep the cache current for next time.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

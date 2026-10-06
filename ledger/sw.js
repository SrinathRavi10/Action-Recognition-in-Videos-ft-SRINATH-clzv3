// Cache-first service worker: after the first visit the whole app runs without a network.
const CACHE = 'paisa-ledger-v2';
const CORE = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js',
  'vendor/fonts/inter-latin-wght-normal.woff2', 'vendor/fonts/inter-latin-ext-wght-normal.woff2',
  'js/app.js', 'js/analytics.js', 'js/categorize.js', 'js/charts.js', 'js/db.js', 'js/demo.js', 'js/i18n.js', 'js/icons.js', 'js/insights.js', 'js/lock.js', 'js/notify.js', 'js/ocr.js', 'js/parser.js', 'js/pdfio.js', 'js/profiles.js', 'js/recurring.js', 'js/store.js', 'js/tax.js', 'js/ui.js', 'js/util.js', 'js/xlsx.js',
  'js/views/bills.js', 'js/views/home.js', 'js/views/importer.js', 'js/views/plan.js', 'js/views/reports.js', 'js/views/settings.js', 'js/views/taxui.js', 'js/views/transactions.js'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
// Same-origin GETs only. Big optional assets (OCR engine) are cached the first time they are used.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match('index.html'))));
});

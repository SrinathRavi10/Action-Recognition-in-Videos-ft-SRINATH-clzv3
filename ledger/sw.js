// Cache-first service worker: after the first visit the whole app runs without a network.
const CACHE = 'paisa-ledger-v1';
const ASSETS = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js',
  'js/app.js', 'js/analytics.js', 'js/categorize.js', 'js/charts.js', 'js/db.js', 'js/demo.js', 'js/parser.js', 'js/pdfio.js', 'js/recurring.js', 'js/store.js', 'js/tax.js', 'js/ui.js', 'js/util.js',
  'js/views/dashboard.js', 'js/views/importer.js', 'js/views/settings.js', 'js/views/subs.js', 'js/views/taxui.js', 'js/views/transactions.js'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).catch(() => caches.match('index.html'))));
});

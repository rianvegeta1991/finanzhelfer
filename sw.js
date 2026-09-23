/* Finanzhelfer – Service Worker (Offline-Betrieb)
 * Bei Dateiänderungen die Versionsnummer hochzählen. */
const CACHE = 'finanzhelfer-v11';
const ASSETS = [
  './',
  './index.html',
  // mit derselben Versionsnummer wie in index.html, sonst landen die
  // Skripte doppelt im Cache und die Seite holt sie trotzdem aus dem Netz
  './daten.js?v=1.10',
  './speicher.js?v=1.10',
  './import.js?v=1.10',
  './dateien.js?v=1.10',
  './banking.js?v=1.10',
  './kurse.js?v=1.10',
  './ansichten.js?v=1.10',
  './app.js?v=1.10',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // einzeln cachen: eine fehlende Datei darf die Installation nicht scheitern lassen
      Promise.all(ASSETS.map((url) =>
        cache.add(url).catch((err) => console.warn('[SW] nicht gecacht:', url, err))
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nur eigene Dateien bedienen. Kursabfragen, Wechselkurse und der Abruf über
  // eine eigene Brücke gehen immer direkt ins Netz – nie aus dem Cache.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((treffer) => {
      if (treffer) return treffer;
      return fetch(event.request)
        .then((antwort) => {
          // Frisch geholte eigene Dateien nachträglich in den Cache legen
          if (antwort.ok){
            const kopie = antwort.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, kopie));
          }
          return antwort;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});

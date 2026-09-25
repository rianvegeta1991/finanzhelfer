/* Finanzhelfer – Service Worker (Offline-Betrieb)
 * Bei Dateiänderungen die Versionsnummer hochzählen. */
const CACHE = 'finanzhelfer-v15';
const ASSETS = [
  './',
  './index.html',
  // mit derselben Versionsnummer wie in index.html, sonst landen die
  // Skripte doppelt im Cache und die Seite holt sie trotzdem aus dem Netz
  './daten.js?v=1.14',
  './speicher.js?v=1.14',
  './import.js?v=1.14',
  './dateien.js?v=1.14',
  './banking.js?v=1.14',
  './kurse.js?v=1.14',
  './ansichten.js?v=1.14',
  './app.js?v=1.14',
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

  // Die Versionsabfrage aus „Nach Update suchen“ muss am Cache vorbei.
  if (url.searchParams.has('stand')) return;

  // Die Seite selbst IMMER zuerst aus dem Netz holen.
  //
  // Vorher lief auch sie über den Cache – und weil index.html ohne
  // Versionsnummer gecacht wird, bekam ein Besucher nach einem Update weiter
  // die alte Seite mit den alten `?v=`-Skripten serviert. Die App blieb
  // dadurch auf ihrem Stand stehen, obwohl längst eine neue Fassung online
  // war. Erst der Netzversuch, dann der Cache: offline funktioniert es
  // genauso wie vorher, online ist man sofort aktuell.
  const istSeite = event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') || '').includes('text/html');
  if (istSeite){
    event.respondWith(
      fetch(event.request).then((antwort) => {
        if (antwort && antwort.ok){
          const kopie = antwort.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', kopie));
        }
        return antwort;
      }).catch(() => caches.match('./index.html').then((t) => t || caches.match('./')))
    );
    return;
  }

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

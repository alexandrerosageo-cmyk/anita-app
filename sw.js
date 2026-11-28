// Service worker: deixa o app abrir rápido e funcionar sem internet.
// Ao publicar uma versão nova, aumente o número abaixo.
const CACHE = 'anita-v49';
const ARQUIVOS = ['./', './index.html', './styles.css', './js/app.js', './js/calc.js', './js/store.js', './js/planilha.js', './js/analise.js', './js/convenio.js', './js/cct.js', './js/ponto.js', './js/escala.js', './js/xlsx-mini.js', './js/firebase-config.js', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// Rede primeiro para os arquivos do app (pega atualizações), cache se estiver offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});

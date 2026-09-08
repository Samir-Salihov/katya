/* ═══ SERVICE WORKER — офлайн-оболочка «Для тебя» ═══
   При изменении файлов подними версию кэша (katya-v1 → katya-v2),
   чтобы старый кэш очистился при активации. */
const CACHE = 'katya-v3';

/* Оболочка приложения — должна закэшироваться целиком при установке */
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',

  './css/main.css',
  './css/base/variables.css',
  './css/base/reset.css',
  './css/base/typography.css',
  './css/base/animations.css',
  './css/base/responsive.css',
  './css/base/app.css',
  './css/components/envelope.css',
  './css/components/splash.css',
  './css/components/install-hint.css',
  './css/components/side-nav.css',
  './css/components/lightbox.css',
  './css/components/player.css',
  './css/components/cursor-hearts.css',
  './css/sections/hero.css',
  './css/sections/strip.css',
  './css/sections/parallax.css',
  './css/sections/gallery.css',
  './css/sections/map.css',
  './css/sections/timeline.css',
  './css/sections/samir-letter.css',
  './css/sections/quotes.css',
  './css/sections/letter.css',
  './css/sections/secret.css',
  './css/sections/memory.css',
  './css/sections/story.css',
  './css/sections/reasons.css',
  './css/sections/hearts.css',
  './css/sections/call.css',
  './css/sections/counter.css',
  './css/sections/stars.css',
  './css/sections/footer.css',

  './js/haptics.js',
  './js/intro.js',
  './js/install-hint.js',
  './js/side-nav.js',
  './js/reveal.js',
  './js/lightbox.js',
  './js/samir-letter.js',
  './js/secret.js',
  './js/memory.js',
  './js/hearts.js',
  './js/cursor-hearts.js',
  './js/stars.js',
  './js/counter.js',
  './js/player.js',
  './js/call.js',
  './js/pwa.js',

  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

/* Музыка — может отсутствовать в проекте; кэшируем «мягко», без падения установки.
   Как только добавишь MP3 в audio/ и обновишь версию кэша — они станут доступны офлайн. */
const OPTIONAL = [
  './audio/01-karma.mp3',
  './audio/02-ya-lyublyu.mp3',
  './audio/03-ne-po-puti.mp3',
  './audio/04-him-and-i.mp3',
  './audio/05-stan.mp3',
  './audio/06-say-yes.mp3',
  './audio/07-i-know.mp3',
  './audio/08-shape.mp3',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    await Promise.allSettled(OPTIONAL.map((u) => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // сторонние домены — как обычно
  if (req.headers.has('range')) return;              // перемотка аудио — напрямую в сеть

  const isNav = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  // Навигация: сеть в приоритете (свежий контент), офлайн — из кэша
  if (isNav) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE);
        return (await cache.match(req)) || (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Статика (css/js/иконки/аудио): отдаём из кэша, в фоне обновляем
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then((resp) => {
      if (resp && resp.ok && resp.type === 'basic') cache.put(req, resp.clone());
      return resp;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});

// sw.js - Service Worker com estratégia Cache-First para assets estáticos

const CACHE_NAME = 'gis-pwa-cache-v7'; // ⚠️ Bump aqui sempre que alterar arquivos estáticos OU dados iniciais.
                                       // Manter sincronizado com DATA_VERSION em app.js.
const STATIC_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './db.js',
    './app.js',
    './manifest.json',
    './data/backup_inicial.json',
    './data/ruas/index.json',
    './data/macrorregioes/macrorregioes.topojson',
    './data/microrregioes/microrregioes.topojson',
    './data/hidrantes/hidrantes.geojson',
    './js/icons.js',
    './js/chamadas.js',
    // Ícones PWA
    './icons/favicon-16.png',
    './icons/favicon-32.png',
    './icons/icon-128.png',
    './icons/icon-152.png',
    './icons/icon-192.png',
    './icons/icon-384.png',
    './icons/icon-512.png',
    // Bibliotecas de terceiros (locais)
    './vendor/leaflet.css',
    './vendor/leaflet-routing-machine.css',
    './vendor/leaflet.markercluster.css',
    './vendor/leaflet.js',
    './vendor/leaflet.markercluster.js',
    './vendor/leaflet-routing-machine.js',
    './vendor/dexie.js',
    './vendor/turf.min.js',
    './vendor/topojson.min.js',
    './vendor/jszip.min.js',
    './vendor/togeojson.umd.js'
];

// Instalação: pré-cacheia os assets essenciais
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Cache aberto:', CACHE_NAME);
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// Ativação: limpa caches antigos e notifica os clients
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(cacheNames => Promise.all(
                cacheNames
                    .filter(cacheName => cacheName !== CACHE_NAME)
                    .map(cacheName => {
                        console.log('[SW] Removendo cache antigo:', cacheName);
                        return caches.delete(cacheName);
                    })
            ))
            .then(() => self.clients.claim())
            .then(() => self.clients.matchAll({ includeUncontrolled: true }))
            .then(clients => {
                // Notifica os clientes sobre a nova versão ativa.
                // app.js poderá comparar com DATA_VERSION e limpar o IndexedDB.
                clients.forEach(client => {
                    client.postMessage({
                        type: 'SW_ACTIVATED',
                        version: CACHE_NAME
                    });
                });
            })
    );
});

// Estratégia: Cache-First com fallback para rede
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Ignora requisições de tiles OSM (tratadas pelo IndexedDB no app)
    if (url.hostname.includes('tile.openstreetmap.org')) {
        return;
    }

    // Ignora Nominatim (geocodificação online)
    if (url.hostname.includes('nominatim.openstreetmap.org')) {
        return;
    }

    // Ignora OSRM (rotas)
    if (url.hostname.includes('router.project-osrm.org')) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                return fetch(event.request).then(response => {
                    if (!response || response.status !== 200 || response.type !== 'basic') {
                        return response;
                    }
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                    });
                    return response;
                });
            })
            .catch(() => {
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            })
    );
});
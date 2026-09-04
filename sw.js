// sw.js - Service Worker com estratégia Cache-First para assets estáticos

const CACHE_NAME = 'gis-pwa-cache-v1';
const STATIC_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './db.js',
    './app.js',
    './manifest.json',
    './data/backup_inicial.json',
    './data/ruas/index.json',
    './data/ruas/rmbh.geojson',
    './icons/icon-192.png',
    './icons/icon-512.png',
    // Bibliotecas de terceiros (locais)
    './vendor/leaflet.css',
    './vendor/leaflet-routing-machine.css',
    './vendor/leaflet.js',
    './vendor/leaflet-routing-machine.js',
    './vendor/dexie.js',
    './vendor/turf.min.js',
    './vendor/jszip.min.js',
    './vendor/togeojson.umd.js'
];

// Instalação: pré-cacheia os assets essenciais
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Cache aberto');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// Ativação: limpa caches antigos
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Estratégia: Cache-First com fallback para rede (exceto para tiles que são tratados pelo aplicativo)
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    
    // Ignora requisições de tiles OSM (serão tratadas pelo IndexedDB no app)
    if (url.hostname.includes('tile.openstreetmap.org')) {
        return; // Não intercepta, deixando a requisição seguir normalmente
    }
    
    // Ignora requisições para Nominatim (API de geocodificação) se quiser cachear, pode incluir, mas vamos deixar passar
    if (url.hostname.includes('nominatim.openstreetmap.org')) {
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                // Se não estiver no cache, busca na rede
                return fetch(event.request).then(response => {
                    // Verifica se a resposta é válida
                    if (!response || response.status !== 200 || response.type !== 'basic') {
                        return response;
                    }
                    // Clona a resposta para armazenar no cache
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseToCache);
                    });
                    return response;
                });
            })
            .catch(() => {
                // Fallback offline para navegação
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            })
    );
});
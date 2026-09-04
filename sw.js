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
    // Bibliotecas de terceiros (CDN)
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/dexie@4.0.4/dist/dexie.js',
    'https://unpkg.com/@turf/turf@7.0.0/turf.min.js',
    'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
    'https://unpkg.com/@tmcw/togeojson@5.0.0/dist/togeojson.umd.js'
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
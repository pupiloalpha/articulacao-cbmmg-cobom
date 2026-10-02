// sw.js - Service Worker com estratégias diferenciadas por tipo de recurso
//
// Estratégias:
//   • HTML / navegação       → network-first (fallback cache) — updates rápidos
//   • Assets estáticos       → cache-first (imutáveis na prática)
//   • APIs externas          → ignoradas (a app faz fetch direto)
//   • Tiles OSM / Nominatim / OSRM → ignoradas (IndexedDB / fetch direto)
//
// ⚠️ Manter CACHE_NAME sincronizado com DATA_VERSION em app.js.

const CACHE_NAME = 'gis-pwa-cache-v14';  // ⚠️ Bump em conjunto com DATA_VERSION

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
    './data/hospitais/hospitais_referencia_mg.geojson',
    './data/samu/samu_centrais.json',
    // Módulos JS
    './js/network.js',
    './js/utils.js',
    './js/map.js',
    './js/icons.js',
    './js/eventos.js',
    './js/weather.js',
    './js/chamadas.js',
    './js/layers.js',
    './js/search.js',
    './js/gps.js',
    './js/tiles.js',
    './js/admin.js',
    // Ícones PWA
    './icons/favicon-16.png',
    './icons/favicon-32.png',
    './icons/favicon-96x96.png',
    './icons/favicon.ico',
    './icons/icon-152.png',
    './icons/icon-167.png',
    './icons/icon-180.png',
    './icons/icon-192.png',
    './icons/icon-256.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png',
    // Bibliotecas
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

// ===========================================================================
// Domínios que NÃO devem passar pelo SW (a app os trata diretamente)
// ===========================================================================
const BYPASS_HOSTS = [
    'tile.openstreetmap.org',
    'nominatim.openstreetmap.org',
    'router.project-osrm.org',
    'painel-fogo-proxy.pesmesquita.workers.dev',
    'raw.githubusercontent.com',
    // Clima
    'tile.openweathermap.org',
    'api.rainviewer.com',
    'tilecache.rainviewer.com',
    'api.open-meteo.com'
];

function shouldBypass(url) {
    return BYPASS_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h));
}

// ===========================================================================
// INSTALL — pré-cacheia assets essenciais
// ===========================================================================
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Cache aberto:', CACHE_NAME);
                // addAll falha inteiro se QUALQUER asset falhar. Para
                // robustez, fazemos add individual e logamos os erros.
                return Promise.all(
                    STATIC_ASSETS.map(url =>
                        cache.add(url).catch(err =>
                            console.warn('[SW] Falha ao pré-cachear:', url, err.message)
                        )
                    )
                );
            })
            .then(() => self.skipWaiting())
    );
});

// ===========================================================================
// ACTIVATE — limpa caches antigos e notifica os clients
// ===========================================================================
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(cacheNames => Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => {
                        console.log('[SW] Removendo cache antigo:', name);
                        return caches.delete(name);
                    })
            ))
            .then(() => self.clients.claim())
            .then(() => self.clients.matchAll({ includeUncontrolled: true }))
            .then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'SW_ACTIVATED',
                        version: CACHE_NAME
                    });
                });
            })
    );
});

// ===========================================================================
// FETCH — estratégias diferenciadas
// ===========================================================================
self.addEventListener('fetch', event => {
    const req = event.request;

    // Só intercepta GET (POST/PUT/DELETE passam direto).
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // 1) Domínios externos específicos → passam direto para a rede.
    if (shouldBypass(url)) return;

    // 2) Requisições cross-origin que não sejam de assets locais → rede direta.
    if (url.origin !== self.location.origin) return;

    // 3) Navegação HTML → network-first (permite updates rápidos do index).
    const isHTMLNavigation =
        req.mode === 'navigate' ||
        req.destination === 'document' ||
        (req.headers.get('accept') || '').includes('text/html');

    if (isHTMLNavigation) {
        event.respondWith(networkFirstHTML(req));
        return;
    }

    // 4) Assets estáticos → cache-first.
    event.respondWith(cacheFirst(req));
});

/**
 * Network-first para HTML: tenta rede, cai para cache.
 * Ao receber resposta da rede, atualiza o cache.
 */
async function networkFirstHTML(req) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const networkResp = await fetch(req);
        if (networkResp && networkResp.status === 200) {
            // Atualiza cache em background
            cache.put(req, networkResp.clone()).catch(() => {});
        }
        return networkResp;
    } catch (_) {
        // Offline: usa cache ou o index.html shell.
        const cached = await cache.match(req);
        if (cached) return cached;
        const shell = await cache.match('./index.html');
        if (shell) return shell;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
}

/**
 * Cache-first para assets estáticos: cache → rede → fallback.
 */
async function cacheFirst(req) {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
        const networkResp = await fetch(req);
        // Só cacheia respostas válidas e same-origin básicas.
        if (networkResp && networkResp.status === 200 && networkResp.type === 'basic') {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, networkResp.clone()).catch(() => {});
        }
        return networkResp;
    } catch (_) {
        // Sem cache e sem rede: 503.
        return new Response('Recurso indisponível offline', {
            status: 503,
            statusText: 'Offline'
        });
    }
}

// ===========================================================================
// MENSAGENS (opcional — permite refresh forçado pelo app)
// ===========================================================================
self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
// js/network.js
// ---------------------------------------------------------------------------
// Detecção e adaptação de condições de rede/dispositivo.
//
// Classifica o ambiente em 4 perfis de rede + 3 classes de dispositivo e
// expõe parâmetros ajustados para:
//   • Timeouts de fetch (Nominatim, OSRM, reverse, eventos)
//   • Limite de resultados e paralelismo de busca
//   • Concorrência de download de tiles
//   • Top-N de rotas com ETA
//
// Nenhuma funcionalidade é removida — apenas calibrada.
// ---------------------------------------------------------------------------

const NETWORK_PROFILES = {
    FAST: {
        name: 'Rápido (cabo/Wi-Fi)',
        nominatimTimeout: 12000,
        osrmTimeout: 6000,
        reverseGeocodeTimeout: 5000,
        eventosTimeout: 22000,
        tileConcurrency: 12,
        nominatimLimit: 20,
        parallelNominatim: true,
        prefetchStreets: true,
        fetchTopRoutes: 3,
        searchCacheMax: 100,
        searchCacheTtlMs: 5 * 60 * 1000,
        offlineRouteMaxEdges: 1800
    },
    BALANCED: {
        name: 'Equilibrado (4G)',
        nominatimTimeout: 8000,
        osrmTimeout: 4500,
        reverseGeocodeTimeout: 3500,
        eventosTimeout: 18000,
        tileConcurrency: 6,
        nominatimLimit: 12,
        parallelNominatim: true,
        prefetchStreets: true,
        fetchTopRoutes: 3,
        searchCacheMax: 60,
        searchCacheTtlMs: 5 * 60 * 1000,
        offlineRouteMaxEdges: 1500
    },
    ECONOMY: {
        name: 'Econômico (3G)',
        nominatimTimeout: 6000,
        osrmTimeout: 4000,
        reverseGeocodeTimeout: 3000,
        eventosTimeout: 15000,
        tileConcurrency: 3,
        nominatimLimit: 8,
        parallelNominatim: false,
        prefetchStreets: false,
        fetchTopRoutes: 2,
        searchCacheMax: 30,
        searchCacheTtlMs: 5 * 60 * 1000,
        offlineRouteMaxEdges: 900
    },
    MINIMAL: {
        name: 'Mínimo (2G/saveData)',
        nominatimTimeout: 5000,
        osrmTimeout: 3000,
        reverseGeocodeTimeout: 2500,
        eventosTimeout: 12000,
        tileConcurrency: 2,
        nominatimLimit: 5,
        parallelNominatim: false,
        prefetchStreets: false,
        fetchTopRoutes: 1,
        searchCacheMax: 15,
        searchCacheTtlMs: 5 * 60 * 1000,
        offlineRouteMaxEdges: 600
    }
};

let currentNetworkProfile = NETWORK_PROFILES.BALANCED;
let currentNetworkInfo = {};

// ---------------------------------------------------------------------------
// Classificação de dispositivo — 3 tiers
// ---------------------------------------------------------------------------
const DEVICE_BREAKPOINTS = {
    MOBILE_MAX: 768,      // <= 768 → mobile
    TABLET_MAX: 1024      // 769..1024 → tablet; >= 1025 → desktop
};

/**
 * Retorna 'mobile' | 'tablet' | 'desktop' de acordo com a viewport atual.
 * Não usa UA sniffing como fonte primária — apenas largura real.
 */
function getDeviceClass() {
    if (typeof window === 'undefined') return 'desktop';
    const w = window.innerWidth || 1024;
    if (w <= DEVICE_BREAKPOINTS.MOBILE_MAX) return 'mobile';
    if (w <= DEVICE_BREAKPOINTS.TABLET_MAX) return 'tablet';
    return 'desktop';
}

/**
 * Aplica `data-device` no <body> para que o CSS responda com precisão
 * mesmo onde @media depende do viewport (ex.: drawers).
 */
function applyDeviceClassToBody() {
    if (typeof document === 'undefined' || !document.body) return;
    const cls = getDeviceClass();
    if (document.body.dataset.device !== cls) {
        document.body.dataset.device = cls;
    }
}

/**
 * Detecta o perfil de rede mais adequado no momento atual.
 * Prioridade: saveData > effectiveType > downlink × dispositivo.
 */
function detectNetworkProfile() {
    const conn = navigator.connection
        || navigator.mozConnection
        || navigator.webkitConnection
        || {};

    const effectiveType = conn.effectiveType || '4g';
    const saveData      = !!conn.saveData;
    const downlink      = Number(conn.downlink) || 0;
    const rtt           = Number(conn.rtt) || 0;

    const deviceClass = getDeviceClass();
    const isMobile  = deviceClass === 'mobile';
    const isTablet  = deviceClass === 'tablet';
    const isDesktop = deviceClass === 'desktop';

    let profileKey;

    if (saveData || effectiveType === 'slow-2g' || effectiveType === '2g') {
        profileKey = 'MINIMAL';
    } else if (effectiveType === '3g') {
        profileKey = 'ECONOMY';
    } else if (effectiveType === '4g') {
        // Desktop com downlink confortável → FAST
        // Tablet com 4G saudável → BALANCED (mantém consumo contido)
        profileKey = (isDesktop && downlink >= 5) ? 'FAST' : 'BALANCED';
    } else {
        profileKey = isDesktop ? 'FAST' : 'BALANCED';
    }

    currentNetworkInfo = {
        effectiveType,
        saveData,
        downlink,
        rtt,
        isMobile,
        isTablet,
        isDesktop,
        deviceClass,
        profileKey,
        profileName: NETWORK_PROFILES[profileKey].name
    };

    currentNetworkProfile = NETWORK_PROFILES[profileKey];

    // Espelha o perfil no <body> para o CSS reagir (economia visual)
    if (typeof document !== 'undefined' && document.body) {
        document.body.dataset.network = profileKey;
    }

    return currentNetworkProfile;
}

function getNetworkProfile() { return currentNetworkProfile; }
function getNetworkInfo()    { return currentNetworkInfo; }

// ---------------------------------------------------------------------------
// Parâmetros de clima por perfil de rede
// ---------------------------------------------------------------------------
const WEATHER_NETWORK_PARAMS = {
    FAST:     { radarMaxZoom: 7, weatherTileConcurrency: 8, openMeteoTimeout: 5000 },
    BALANCED: { radarMaxZoom: 7, weatherTileConcurrency: 5, openMeteoTimeout: 4000 },
    ECONOMY:  { radarMaxZoom: 6, weatherTileConcurrency: 3, openMeteoTimeout: 3500 },
    MINIMAL:  { radarMaxZoom: 5, weatherTileConcurrency: 2, openMeteoTimeout: 3000 }
};

function getWeatherNetworkParams() {
    const key = currentNetworkInfo.profileKey || 'BALANCED';
    return WEATHER_NETWORK_PARAMS[key] || WEATHER_NETWORK_PARAMS.BALANCED;
}

// Re-avalia quando a conexão mudar
if ('connection' in navigator && navigator.connection.addEventListener) {
    navigator.connection.addEventListener('change', () => {
        const oldKey = currentNetworkInfo.profileKey;
        detectNetworkProfile();
        if (oldKey !== currentNetworkInfo.profileKey) {
            console.log(`[Network] Perfil: ${oldKey} → ${currentNetworkInfo.profileKey} (${currentNetworkInfo.profileName})`);
            if (typeof showToast === 'function') {
                showToast(`Rede: ${currentNetworkInfo.profileName}`, 'info', 1800);
            }
        }
    });
}

// Re-avalia em mudanças de viewport (rotação, resize, tablet ↔ desktop)
// Reage aos dois breakpoints reais da aplicação
const mqMobile = window.matchMedia(`(max-width: ${DEVICE_BREAKPOINTS.MOBILE_MAX}px)`);
const mqTablet = window.matchMedia(`(min-width: ${DEVICE_BREAKPOINTS.MOBILE_MAX + 1}px) and (max-width: ${DEVICE_BREAKPOINTS.TABLET_MAX}px)`);
const onViewportChange = () => {
    applyDeviceClassToBody();
    detectNetworkProfile();
};
mqMobile.addEventListener?.('change', onViewportChange);
mqTablet.addEventListener?.('change', onViewportChange);

// Aplicação inicial — DOMContentLoaded garante que <body> já existe
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        applyDeviceClassToBody();
        detectNetworkProfile();
    }, { once: true });
} else {
    applyDeviceClassToBody();
    detectNetworkProfile();
}

window.NETWORK_PROFILES     = NETWORK_PROFILES;
window.DEVICE_BREAKPOINTS   = DEVICE_BREAKPOINTS;
window.detectNetworkProfile = detectNetworkProfile;
window.getNetworkProfile    = getNetworkProfile;
window.getNetworkInfo       = getNetworkInfo;
window.getDeviceClass       = getDeviceClass;
window.applyDeviceClassToBody = applyDeviceClassToBody;
window.getWeatherNetworkParams = getWeatherNetworkParams;
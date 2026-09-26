// js/network.js
// ---------------------------------------------------------------------------
// Detecção e adaptação de condições de rede/dispositivo.
//
// Classifica o ambiente em 4 perfis e expõe parâmetros ajustados para:
//   • Timeouts de fetch (Nominatim, OSRM, reverse, eventos)
//   • Limite de resultados e paralelismo de busca
//   • Concorrência de download de tiles
//   • Top-N de rotas com ETA
//
// Nenhuma funcionalidade é removida — apenas calibrada.
// ---------------------------------------------------------------------------

const NETWORK_PROFILES = {
    // Desktop em cabo/Wi-Fi rápido: máxima qualidade e paralelismo
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
    // 4G equilibrado
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
    // 3G móvel: econômico, séries para reduzir rajadas
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
    // 2G / saveData: mínimo absoluto
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

    const isMobile  = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
                    || window.matchMedia('(max-width: 768px)').matches;
    const isDesktop = !isMobile;

    let profileKey;

    if (saveData || effectiveType === 'slow-2g' || effectiveType === '2g') {
        profileKey = 'MINIMAL';
    } else if (effectiveType === '3g') {
        profileKey = 'ECONOMY';
    } else if (effectiveType === '4g') {
        // 4G em desktop com downlink confortável: pode promover para FAST
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
        isDesktop,
        profileKey,
        profileName: NETWORK_PROFILES[profileKey].name
    };

    currentNetworkProfile = NETWORK_PROFILES[profileKey];
    return currentNetworkProfile;
}

function getNetworkProfile() { return currentNetworkProfile; }
function getNetworkInfo()    { return currentNetworkInfo; }

// Re-avalia quando a conexão mudar (troca de Wi-Fi ↔ 4G, degradação, etc.)
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

// Detecta mudança de viewport (rotação de tela, resize para mobile)
window.matchMedia('(max-width: 768px)').addEventListener?.('change', () => {
    detectNetworkProfile();
});

// Inicialização
detectNetworkProfile();

window.NETWORK_PROFILES    = NETWORK_PROFILES;
window.detectNetworkProfile = detectNetworkProfile;
window.getNetworkProfile   = getNetworkProfile;
window.getNetworkInfo      = getNetworkInfo;
// app.js - Entrada e Orquestração Principal da Aplicação

// ============================================================
// VERSÃO DOS DADOS
// ------------------------------------------------------------
// Deve ser incrementada SEMPRE em conjunto com CACHE_NAME em sw.js.
// Ao detectar mudança (localStorage × DATA_VERSION), todas as camadas
// do IndexedDB são limpas, forçando o recarregamento das informações
// atualizadas do repositório.
// ============================================================
const DATA_VERSION = 'v6';

// Variáveis de estado global compartilhadas entre módulos
let map;
let mapClickMode = false;
let baseLayer;
let overlayLayers = {};
let originMarker = null;
let currentOrigin = null;   // armazena a origem atual { lat, lng, description }
window.isAdmin = false;
let drawingMode = null;
let polygonPoints = [];
let polygonTempLayer = null;
let adminPinHash = localStorage.getItem('adminPinHash');
let viewMode = 'all';
let layerVisibility = {};

// Guarda o estado de visualização anterior para restaurar ao sair do modo origem
let previousViewModeBeforeOrigin = null;
let previousLayerVisibilityBeforeOrigin = null;

// Guarda o estado de visualização anterior para restaurar ao sair do modo "rota"
let previousViewModeBeforeRoute = null;
let previousLayerVisibilityBeforeRoute = null;

// ============================================================
// MODO "VISUALIZAÇÃO DE ROTA"
// ------------------------------------------------------------
// Durante o desenho de uma rota, escondemos as feições (polígonos) para
// que apenas os pontos permaneçam visíveis, facilitando a interação do
// mouse com a linha de rota e os marcadores.
// ============================================================

/**
 * Ativa o modo "somente pontos". Salva o estado atual antes de alterar,
 * para possibilitar restauração posterior.
 */
async function enterRouteViewMode() {
    if (viewMode === 'points') return;

    if (previousViewModeBeforeRoute === null) {
        previousViewModeBeforeRoute = viewMode;
        previousLayerVisibilityBeforeRoute = { ...layerVisibility };
    }

    viewMode = 'points';
    syncViewCheckboxes('points');
    await reloadLayers();
}

/**
 * Sai do modo "somente pontos", restaurando o modo anterior.
 */
async function exitRouteViewMode() {
    if (previousViewModeBeforeRoute === null) return;

    viewMode = previousViewModeBeforeRoute;
    syncViewCheckboxes(viewMode);

    if (previousLayerVisibilityBeforeRoute) {
        layerVisibility = { ...previousLayerVisibilityBeforeRoute };
    }

    clearRouteViewState();
    await reloadLayers();
}

/**
 * Limpa o estado salvo do modo rota (sem restaurar a visualização).
 * Usado quando o usuário muda manualmente o modo de visualização ou
 * quando o app é reiniciado.
 */
function clearRouteViewState() {
    previousViewModeBeforeRoute = null;
    previousLayerVisibilityBeforeRoute = null;
}

/**
 * Sai do modo "definir origem no mapa".
 */
function exitMapOriginMode(restore = true) {
    mapClickMode = false;

    const btn = document.getElementById('mapOriginBtn');
    if (btn) btn.textContent = '🎯 Ponto no mapa';
    if (map) map.getContainer().style.cursor = '';

    if (restore) {
        const modeToRestore = previousViewModeBeforeOrigin !== null ? previousViewModeBeforeOrigin : 'all';
        setViewMode(modeToRestore);
        syncViewCheckboxes(modeToRestore);

        if (previousLayerVisibilityBeforeOrigin) {
            layerVisibility = { ...previousLayerVisibilityBeforeOrigin };
            reloadLayers();
        }
    }

    previousViewModeBeforeOrigin = null;
    previousLayerVisibilityBeforeOrigin = null;
}

// ============================================================
// VERIFICAÇÃO DE VERSÃO DOS DADOS (limpa IndexedDB se necessário)
// ============================================================
async function checkDataVersion() {
    const storedDataVersion = localStorage.getItem('appDataVersion');

    if (storedDataVersion !== null && storedDataVersion !== DATA_VERSION) {
        try {
            console.log(`[App] Versão dos dados alterada (${storedDataVersion} → ${DATA_VERSION}). Limpando camadas do IndexedDB...`);
            await db.layers.clear();
            console.log('[App] Camadas limpas. Serão recarregadas do repositório.');
        } catch (e) {
            console.warn('[App] Erro ao limpar camadas do IndexedDB:', e);
        }
    }

    localStorage.setItem('appDataVersion', DATA_VERSION);
}

// Configuração e Inicialização Principal ao carregar o DOM
document.addEventListener('DOMContentLoaded', async () => {

    // ------------------------------------------------------------
    // ETAPA 0: Verifica/invalida camadas do IndexedDB se a versão mudou.
    // ------------------------------------------------------------
    await checkDataVersion();

    initMap();
    updateOnlineStatus();

    // Controle da Sidebar / Painel Lateral
    const sidebar = document.getElementById('sidebar');
    const showBtn = document.getElementById('sidebarShowBtn');
    const toggleBtn = document.getElementById('sidebarToggle');
    const resetBtn = document.getElementById('resetBtn');

    // ------------------------------------------------------------
    // Mobile: inicia com a sidebar recolhida para priorizar o mapa.
    // ------------------------------------------------------------
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (isMobile && sidebar) {
        sidebar.classList.add('collapsed');
    }

    if (sidebar && showBtn) {
        if (sidebar.classList.contains('collapsed')) {
            showBtn.classList.remove('hidden');
        } else {
            showBtn.classList.add('hidden');
        }

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                sidebar.classList.toggle('collapsed');
                if (sidebar.classList.contains('collapsed')) {
                    showBtn.classList.remove('hidden');
                } else {
                    showBtn.classList.add('hidden');
                }
            });
        }

        showBtn.addEventListener('click', () => {
            sidebar.classList.remove('collapsed');
            showBtn.classList.add('hidden');
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', resetAll);
    }

    // ============================================================
    // 1. Carregamento harmônico das camadas + spinner central
    // ============================================================
    const loadingOverlay = document.getElementById('map-loading-overlay');
    const loadingText = document.getElementById('loading-status-text');

    function showLoading(msg) {
        if (loadingOverlay) loadingOverlay.classList.remove('hidden');
        if (loadingText) loadingText.textContent = msg || 'Carregando...';
    }

    function hideLoading() {
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
    }

    showLoading('Inicializando mapa e dados operacionais...');

    try {
        showLoading('Carregando Unidades BM e Articulação CBMMG...');
        await seedInitialData();
        await cleanupMunicipioFeatures();

        await reloadLayers();

        showLoading('Carregando Macrorregiões, Microrregiões e Hospitais...');
        await Promise.all([
            loadMicroMacroRegions(),
            loadHospitalsData()
        ]);

        await reloadLayers();
        zoomToAllFeatures();

        showLoading('Pronto!');
        setTimeout(hideLoading, 500);

    } catch (err) {
        console.warn('Falha parcial no carregamento inicial:', err);
        if (map) map.setView([-15.7934, -47.8822], 4);
        showLoading('Erro parcial no carregamento. Mapa disponível.');
        setTimeout(hideLoading, 1800);
    }

    initEventosMG().catch(e => console.warn('Falha ao inicializar eventos de fogo:', e));

    setupAuth();
    initAdminAuthListeners();
    setupFileUpload();
    setupDrawingTools();
    setupGpsTracking();
    setupTileDownload();
    initEditFeatureModalListeners();

    // ============================================================
    // 2. Botão "Definir origem no mapa"
    // ============================================================
    const mapOriginBtn = document.getElementById('mapOriginBtn');
    if (mapOriginBtn) {
        mapOriginBtn.addEventListener('click', () => {
            if (mapClickMode) {
                exitMapOriginMode(true);
                showToast('Marcação de origem cancelada.', 'info');
            } else {
                previousViewModeBeforeOrigin = viewMode;
                previousLayerVisibilityBeforeOrigin = { ...layerVisibility };

                setViewMode('none');
                syncViewCheckboxes('none');

                mapClickMode = true;
                mapOriginBtn.textContent = 'Cancelar marcação';
                if (map) map.getContainer().style.cursor = 'crosshair';
                showToast('Clique no mapa para definir a origem (feições ocultas temporariamente).', 'info', 4000);
            }
        });
    }

    // Controle da busca por endereço
    const searchInputEl = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    let searchDebounceTimer = null;

    if (searchBtn && searchInputEl) {
        searchBtn.addEventListener('click', () => {
            const query = searchInputEl.value.trim();
            if (query) searchAddress(query);
        });

        searchInputEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const query = e.target.value.trim();
                if (query) searchAddress(query);
            }
        });

        searchInputEl.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            clearTimeout(searchDebounceTimer);
            if (!query) {
                const resDiv = document.getElementById('searchResults');
                if (resDiv) resDiv.innerHTML = '';
                return;
            }
            if (query.length >= 2) {
                searchDebounceTimer = setTimeout(() => {
                    searchAddress(query);
                }, 300);
            }
        });
    }

    // ============================================================
    // Checkboxes de modo de visualização
    // ------------------------------------------------------------
    // Mudança manual pelo usuário sai do "modo rota" (se ativo).
    // ============================================================
    document.querySelectorAll('.view-checkbox').forEach(cb => {
        cb.addEventListener('change', function () {
            // Se o usuário mudou o modo manualmente, abandona o modo rota
            clearRouteViewState();

            if (this.checked) {
                document.querySelectorAll('.view-checkbox').forEach(other => {
                    if (other !== this) other.checked = false;
                });
                setViewMode(this.dataset.mode);
            } else {
                const anyChecked = document.querySelector('.view-checkbox:checked');
                if (!anyChecked) {
                    const defaultCb = document.querySelector('.view-checkbox[data-mode="all"]');
                    if (defaultCb) defaultCb.checked = true;
                    setViewMode('all');
                }
            }
        });
    });

    syncViewCheckboxes(viewMode);

    // Online / Offline
    window.addEventListener('online', () => {
        updateOnlineStatus();
        reloadLayers();
        showToast('Conexão restaurada. Tiles online disponíveis.', 'success', 2500);
    });
    window.addEventListener('offline', () => {
        updateOnlineStatus();
        reloadLayers();
        showToast('Modo offline. Malha de logradouros exibida como referência.', 'warning', 3500);
    });

    // Registro do Service Worker PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(registration => {
                    console.log('[App] Service Worker registrado:', registration.scope);
                })
                .catch(error => {
                    console.error('[App] Falha ao registrar Service Worker:', error);
                });
        });

        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'SW_ACTIVATED') {
                console.log('[App] Novo Service Worker ativado:', event.data.version);
            }
        });
    }
});

// Função resetAll - Limpa dados temporários e recupera vista inicial
async function resetAll() {
    const searchResults = document.getElementById('searchResults');
    const distanceResults = document.getElementById('distanceResults');
    const searchInput = document.getElementById('searchInput');

    if (searchResults) searchResults.innerHTML = '';
    if (distanceResults) distanceResults.innerHTML = '';
    if (searchInput) searchInput.value = '';

    // Sai do "modo rota" e limpa o estado salvo
    clearRouteViewState();

    if (mapClickMode) {
        exitMapOriginMode(false);
    }

    viewMode = 'all';
    syncViewCheckboxes('all');
    layerVisibility = {};

    await reloadLayers();

    if (originMarker && map) {
        map.removeLayer(originMarker);
        originMarker = null;
    }
    if (window.distanceLine && map) {
        map.removeLayer(window.distanceLine);
        window.distanceLine = null;
    }
    if (window.distanceMarker && map) {
        map.removeLayer(window.distanceMarker);
        window.distanceMarker = null;
    }
    if (window.routingControl && map) {
        map.removeControl(window.routingControl);
        window.routingControl = null;
    }

    currentOrigin = null;

    if (map) {
        zoomToAllFeatures();
    }

    showToast('Campos e origem limpos. Visualização restaurada.', 'info');
}
window.resetAll = resetAll;

// Exporta funções para uso em map.js / layers.js
window.exitMapOriginMode = exitMapOriginMode;
window.enterRouteViewMode = enterRouteViewMode;
window.exitRouteViewMode = exitRouteViewMode;
window.clearRouteViewState = clearRouteViewState;
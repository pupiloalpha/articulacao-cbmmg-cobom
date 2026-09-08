// app.js - Entrada e Orquestração Principal da Aplicação

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

/**
 * Sai do modo "definir origem no mapa".
 * @param {boolean} restore - se true, restaura o modo de visualização e a visibilidade das camadas anteriores.
 */
function exitMapOriginMode(restore = true) {
    mapClickMode = false;

    const btn = document.getElementById('mapOriginBtn');
    if (btn) btn.textContent = '🎯 Ponto no mapa';
    if (map) map.getContainer().style.cursor = '';

    if (restore) {
        // Restaura o modo de visualização anterior (ou 'all' como fallback)
        const modeToRestore = previousViewModeBeforeOrigin !== null ? previousViewModeBeforeOrigin : 'all';
        setViewMode(modeToRestore);
        syncViewCheckboxes(modeToRestore);

        if (previousLayerVisibilityBeforeOrigin) {
            layerVisibility = { ...previousLayerVisibilityBeforeOrigin };
            // reloadLayers respeita layerVisibility
            reloadLayers();
        }
    }

    previousViewModeBeforeOrigin = null;
    previousLayerVisibilityBeforeOrigin = null;
}

// Configuração e Inicialização Principal ao carregar o DOM
document.addEventListener('DOMContentLoaded', async () => {
    initMap();
    updateOnlineStatus();

    // Controle da Sidebar / Painel Lateral
    const sidebar = document.getElementById('sidebar');
    const showBtn = document.getElementById('sidebarShowBtn');
    const toggleBtn = document.getElementById('sidebarToggle');
    const resetBtn = document.getElementById('resetBtn');

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
    // Etapa A – Dados essenciais (Unidades BM + Articulação)
    showLoading('Carregando Unidades BM e Articulação CBMMG...');
    await seedInitialData();
    await cleanupMunicipioFeatures();

    // Mostra imediatamente o que já temos (feedback visual rápido)
    await reloadLayers();

    // Etapa B – Dados de Saúde (paralelo)
    showLoading('Carregando Macrorregiões, Microrregiões e Hospitais...');
    await Promise.all([
        loadMicroMacroRegions(),
        loadHospitalsData()
    ]);

    // Atualiza o mapa com tudo (exceto ruas – lazy)
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

    // Restante da inicialização
    setupAuth();
    initAdminAuthListeners();
    setupFileUpload();
    setupDrawingTools();
    setupGpsTracking();
    setupTileDownload();
    initEditFeatureModalListeners();

    // ============================================================
    // 2. Botão "Definir origem no mapa" – oculta feições temporariamente
    // ============================================================
    const mapOriginBtn = document.getElementById('mapOriginBtn');
    if (mapOriginBtn) {
        mapOriginBtn.addEventListener('click', () => {
            if (mapClickMode) {
                // Cancelar → restaura
                exitMapOriginMode(true);
                showToast('Marcação de origem cancelada.', 'info');
            } else {
                // Entrar no modo: salva estado e oculta feições
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

    // Controle da busca por endereço e autocomplete debounce
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

    // Checkboxes de modo de visualização (Todas, Pontos, Limpo)
    document.querySelectorAll('.view-checkbox').forEach(cb => {
        cb.addEventListener('change', function() {
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

    // Registro do Service Worker PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(registration => {
                    console.log('Service Worker registrado com sucesso:', registration.scope);
                })
                .catch(error => {
                    console.error('Falha ao registrar Service Worker:', error);
                });
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

    // Sai do modo origem (se estiver ativo)
    if (mapClickMode) {
        exitMapOriginMode(false); // limpa flags sem restaurar ainda
    }

    // Sempre volta para o modo padrão "all"
    viewMode = 'all';
    syncViewCheckboxes('all');

    // Limpa qualquer sobrescrita de visibilidade individual
    layerVisibility = {};

    // Aguarda o recarregamento completo das camadas
    await reloadLayers();

    // Remove marcador de origem
    if (originMarker && map) {
        map.removeLayer(originMarker);
        originMarker = null;
    }
    // Remove linhas e marcadores de distância
    if (window.distanceLine && map) {
        map.removeLayer(window.distanceLine);
        window.distanceLine = null;
    }
    if (window.distanceMarker && map) {
        map.removeLayer(window.distanceMarker);
        window.distanceMarker = null;
    }
    // Remove controle de roteamento
    if (window.routingControl && map) {
        map.removeControl(window.routingControl);
        window.routingControl = null;
    }

    currentOrigin = null;

    // Agora sim enquadra nas feições (já estão no mapa)
    if (map) {
        zoomToAllFeatures();
    }

    showToast('Campos e origem limpos. Visualização restaurada.', 'info');
}
window.resetAll = resetAll;

// Exporta a função de saída do modo origem para uso em map.js / layers.js
window.exitMapOriginMode = exitMapOriginMode;
// app.js - Entrada e Orquestração Principal da Aplicação

// Variáveis de estado global compartilhadas entre módulos
let map;
let mapClickMode = false;
let baseLayer;
let overlayLayers = {};
let originMarker = null;
let currentOrigin = null;   // armazena a origem atual { lat, lng, description }
let isAdmin = false;
let drawingMode = null;
let polygonPoints = [];
let polygonTempLayer = null;
let adminPinHash = localStorage.getItem('adminPinHash');
let viewMode = 'all';
let layerVisibility = {};

// Configuração e Inicialização Principal ao carregar o DOM
document.addEventListener('DOMContentLoaded', () => {
    initMap();

    try {
        await seedInitialData();
        await loadStreetDataFromGitHub();
        
        if (typeof reloadLayers === 'function') {
            await reloadLayers();
        }
        zoomToAllFeatures();
    } catch (e) {
        console.warn('Erro ao inicializar dados assíncronos:', e);
    }
    
    setupAuth();
    initAdminAuthListeners();
    setupFileUpload();
    setupDrawingTools();
    setupGpsTracking();
    setupTileDownload();
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

    // RECUPERADO: Controle do botão de definir origem manualmente no mapa
    const mapOriginBtn = document.getElementById('mapOriginBtn');
    if (mapOriginBtn) {
        mapOriginBtn.addEventListener('click', () => {
            mapClickMode = !mapClickMode;
            if (mapClickMode) {
                mapOriginBtn.textContent = 'Cancelar marcação';
                if (map) map.getContainer().style.cursor = 'crosshair';
                showToast('Clique no mapa para definir a origem.', 'info');
            } else {
                mapOriginBtn.textContent = '🎯 Definir origem no mapa';
                if (map) map.getContainer().style.cursor = '';
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

// Função resetAll - Limpa dados temporários e recupera vista inicial (ajustada)
function resetAll() {
    const searchResults = document.getElementById('searchResults');
    const distanceResults = document.getElementById('distanceResults');
    const searchInput = document.getElementById('searchInput');

    if (searchResults) searchResults.innerHTML = '';
    if (distanceResults) distanceResults.innerHTML = '';
    if (searchInput) searchInput.value = '';

    if (mapClickMode) {
        mapClickMode = false;
        const btn = document.getElementById('mapOriginBtn');
        if (btn) btn.textContent = '🎯 Definir origem no mapa';
        if (map) map.getContainer().style.cursor = '';
    }

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
    // Remove controle de roteamento, se existir
    if (window.routingControl && map) {
        map.removeControl(window.routingControl);
        window.routingControl = null;
    }
    // Reseta a origem atual
    currentOrigin = null;
    if (map) map.setView([-15.7934, -47.8822], 4);
    showToast('Campos e origem limpos.', 'info');
}
// Exporta globalmente para uso no app.js
window.resetAll = resetAll;

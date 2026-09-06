// app.js - Entrada, Controle de Abas e Orquestração Principal da Aplicação

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
    seedInitialData();
    loadStreetDataFromGitHub();
    reloadLayers();
    zoomToAllFeatures();
    setupAuth();
    initAdminAuthListeners();
    setupFileUpload();
    setupDrawingTools();
    setupGpsTracking();
    setupTileDownload();
    initEditFeatureModalListeners();
    updateOnlineStatus();

    // Controle da Sidebar e Botão Flutuante
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

    // Inicialização da Navegação por Abas (Tabs Navigation)
    initSidebarTabs();

    // Atalho rápido de Configuração/Admin no cabeçalho (Ícone ⚙️)
    const quickAdminBtn = document.getElementById('quickAdminBtn');
    if (quickAdminBtn) {
        quickAdminBtn.addEventListener('click', () => {
            if (isAdmin) {
                switchSidebarTab('tab-admin');
            } else {
                const loginModal = document.getElementById('loginModal');
                if (loginModal) loginModal.classList.remove('hidden');
            }
        });
    }

    // Listener do Botão de Origem no Mapa
    const mapOriginBtn = document.getElementById('mapOriginBtn');
    if (mapOriginBtn) {
        mapOriginBtn.addEventListener('click', () => {
            mapClickMode = !mapClickMode;
            if (mapClickMode) {
                mapOriginBtn.textContent = '❌ Cancelar';
                if (map) map.getContainer().style.cursor = 'crosshair';
                showToast('Clique em qualquer ponto do mapa para definir a origem.', 'info');
            } else {
                mapOriginBtn.textContent = '🎯 No Mapa';
                if (map) map.getContainer().style.cursor = '';
            }
        });
    }

    // Controle da busca por endereço com Autocomplete Debounce
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

// Inicialização da Lógica de Alternância das Abas
function initSidebarTabs() {
    const tabButtons = document.querySelectorAll('.sidebar-tabs .tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTabId = btn.dataset.tab;
            switchSidebarTab(targetTabId);
        });
    });
}

// Troca de Aba Ativa
function switchSidebarTab(tabId) {
    const tabButtons = document.querySelectorAll('.sidebar-tabs .tab-btn');
    const tabPanes = document.querySelectorAll('.tab-content-wrapper .tab-pane');

    tabButtons.forEach(btn => {
        if (btn.dataset.tab === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    tabPanes.forEach(pane => {
        if (pane.id === tabId) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });
}

// Exporta a função para escopo global
window.switchSidebarTab = switchSidebarTab;

// Função resetAll - Limpa dados temporários e recupera vista inicial
function resetAll() {
    const searchResults = document.getElementById('searchResults');
    const distanceResults = document.getElementById('distanceResults');
    const searchInput = document.getElementById('searchInput');

    if (searchResults) searchResults.innerHTML = '';
    if (distanceResults) {
        distanceResults.innerHTML = `
            <div class="dispatch-placeholder">
                <p>📍 Digite um endereço, use o GPS ou clique em <strong>"🎯 No Mapa"</strong> para iniciar o cálculo de jurisdição e do Top 5 unidades com ETA.</p>
            </div>
        `;
    }
    if (searchInput) searchInput.value = '';

    if (mapClickMode) {
        mapClickMode = false;
        const btn = document.getElementById('mapOriginBtn');
        if (btn) btn.textContent = '🎯 No Mapa';
        if (map) map.getContainer().style.cursor = '';
    }

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
    if (map) map.setView([-15.7934, -47.8822], 4);
    showToast('Campos e marcações do mapa foram limpos.', 'info');
}

window.resetAll = resetAll;
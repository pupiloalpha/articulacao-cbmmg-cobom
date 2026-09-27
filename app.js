// app.js - Entrada e Orquestração Principal da Aplicação

// ============================================================
// VERSÃO DOS DADOS
// ------------------------------------------------------------
// Deve ser incrementada SEMPRE em conjunto com CACHE_NAME em sw.js.
// Ao detectar mudança (localStorage × DATA_VERSION), todas as camadas
// do IndexedDB são limpas, forçando o recarregamento das informações
// atualizadas do repositório.
// ============================================================
const DATA_VERSION = 'v11';

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
// DETECÇÃO DE DISPOSITIVO E CONTROLE DO DRAWER
// ============================================================
// A sidebar se comporta de forma diferente conforme a largura:
//   • Desktop  (>= 1025px) → persistente, sem backdrop
//   • Tablet   (769..1024) → persistente, sem backdrop, mais estreita
//   • Mobile   (<= 768px)  → drawer overlay, com backdrop, fechada por padrão
//
// A lógica fica centralizada aqui e é chamada tanto na inicialização
// quanto em resize/orientationchange (com debounce).
// ============================================================

function _currentDeviceClass() {
    // Delegado ao network.js quando disponível; fallback local seguro.
    if (typeof window.getDeviceClass === 'function') return window.getDeviceClass();
    const w = window.innerWidth;
    if (w <= 768) return 'mobile';
    if (w <= 1024) return 'tablet';
    return 'desktop';
}

function _updateSidebarBackdrop() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!sidebar || !backdrop) return;

    const isOverlayMode = _currentDeviceClass() === 'mobile';
    const sidebarOpen = !sidebar.classList.contains('collapsed');

    if (isOverlayMode && sidebarOpen) {
        backdrop.classList.remove('hidden');
    } else {
        backdrop.classList.add('hidden');
    }
}

function _closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const showBtn = document.getElementById('sidebarShowBtn');
    if (!sidebar) return;
    sidebar.classList.add('collapsed');
    if (showBtn) showBtn.classList.remove('hidden');
    _updateSidebarBackdrop();
}

function _openSidebar() {
    const sidebar = document.getElementById('sidebar');
    const showBtn = document.getElementById('sidebarShowBtn');
    if (!sidebar) return;
    sidebar.classList.remove('collapsed');
    if (showBtn) showBtn.classList.add('hidden');
    _updateSidebarBackdrop();
}

// ============================================================
// MODO "VISUALIZAÇÃO DE ROTA"
// ------------------------------------------------------------
// Durante o desenho de uma rota, escondemos as feições (polígonos) para
// que apenas os pontos permaneçam visíveis, facilitando a interação do
// mouse com a linha de rota e os marcadores.
//
// Em dispositivos móveis, também recolhemos a sidebar automaticamente,
// ampliando a área útil do mapa durante o traçado.
// ============================================================

/**
 * Detecta se a aplicação está sendo usada em uma viewport móvel.
 * Usa matchMedia para refletir mudanças dinâmicas (rotação, resize).
 */
function isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
}

/**
 * Ativa o modo "somente pontos". Salva o estado atual antes de alterar,
 * para possibilitar restauração posterior.
 *
 * Em viewports móveis, recolhe a sidebar para liberar espaço de tela.
 */
async function enterRouteViewMode() {
    // Recolhe a sidebar em mobile (idempotente: só age se estiver aberta)
    if (isMobileViewport()) {
        const sidebar = document.getElementById('sidebar');
        const showBtn = document.getElementById('sidebarShowBtn');
        if (sidebar && !sidebar.classList.contains('collapsed')) {
            sidebar.classList.add('collapsed');
            if (showBtn) showBtn.classList.remove('hidden');
        }
    }

    // Se já estamos em modo "points" (apenas pontos), não recarrega nada.
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
 * Não reabre a sidebar automaticamente — em mobile o usuário controla
 * quando mostrar o painel novamente.
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

    // Solicita armazenamento persistente para evitar expurgo de tiles e dados offline
    if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then(persisted => {
            if (persisted) console.log('[Storage] Armazenamento persistente concedido.');
        }).catch(() => {});
    }

    initMap();
    updateOnlineStatus();

        // Controle da Sidebar / Painel Lateral
    const sidebar = document.getElementById('sidebar');
    const showBtn = document.getElementById('sidebarShowBtn');
    const toggleBtn = document.getElementById('sidebarToggle');
    const resetBtn = document.getElementById('resetBtn');
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');

    // Em mobile, começa FECHADA (drawer); em tablet/desktop, ABERTA.
    // Respeita preferência salva, se houver.
    const savedSidebarState = localStorage.getItem('cobom_sidebar_state');
    const startCollapsed = savedSidebarState
        ? savedSidebarState === 'collapsed'
        : (_currentDeviceClass() === 'mobile');

    if (sidebar) {
        sidebar.classList.toggle('collapsed', startCollapsed);
    }

    if (sidebar && showBtn) {
        if (sidebar.classList.contains('collapsed')) {
            showBtn.classList.remove('hidden');
        } else {
            showBtn.classList.add('hidden');
        }

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const willBeCollapsed = !sidebar.classList.contains('collapsed');
                sidebar.classList.toggle('collapsed', willBeCollapsed);
                localStorage.setItem('cobom_sidebar_state', willBeCollapsed ? 'collapsed' : 'open');

                if (willBeCollapsed) {
                    showBtn.classList.remove('hidden');
                } else {
                    showBtn.classList.add('hidden');
                }
                _updateSidebarBackdrop();
            });
        }

        showBtn.addEventListener('click', () => {
            _openSidebar();
            localStorage.setItem('cobom_sidebar_state', 'open');
        });

        // Backdrop fecha o drawer ao ser clicado (mobile)
        if (sidebarBackdrop) {
            sidebarBackdrop.addEventListener('click', () => {
                _closeSidebar();
                localStorage.setItem('cobom_sidebar_state', 'collapsed');
            });
        }

        // Aplicação inicial do backdrop
        _updateSidebarBackdrop();

        // Reavalia em resize/orientationchange, com debounce simples
        let _sidebarResizeTimer = null;
        const _onViewportResize = () => {
            clearTimeout(_sidebarResizeTimer);
            _sidebarResizeTimer = setTimeout(() => {
                _updateSidebarBackdrop();
                // Se migrou para desktop/tablet, sempre abre;
                // se migrou para mobile, respeita o último estado salvo.
                const cls = _currentDeviceClass();
                if (cls !== 'mobile') {
                    _openSidebar();
                } else if (localStorage.getItem('cobom_sidebar_state') === 'collapsed') {
                    _closeSidebar();
                }
            }, 150);
        };
        window.addEventListener('resize', _onViewportResize);
        window.addEventListener('orientationchange', _onViewportResize);

        // ESC fecha o drawer em mobile (não interfere com modais — o
        // listener global de atalhos trata primeiro)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && _currentDeviceClass() === 'mobile') {
                const anyModalOpen = document.querySelector('.modal:not(.hidden)');
                if (!anyModalOpen && !sidebar.classList.contains('collapsed')) {
                    _closeSidebar();
                }
            }
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

        showLoading('Carregando Macrorregiões, Microrregiões, Hospitais e Hidrantes...');
        await Promise.all([
            loadMicroMacroRegions(),
            loadHospitalsData(),
            loadHidrantesData()
        ]);

        showLoading('Renderizando camadas operacionais...');
        await reloadLayers();
        zoomToAllFeatures();

        showLoading('Pronto!');
        setTimeout(hideLoading, 400);

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
    setupFloatingSearch();
    initTheme();
    initOperationalKeyboardShortcuts();
    initShortcutsModal();

    // Chips flutuantes + buscador de áreas BM (COB/BBM/CIA IND)
    if (typeof updateMapChips === 'function') updateMapChips();
    if (typeof initAreaSearch === 'function')  initAreaSearch();

    // Botão flutuante de refresh do mapa (substitui F5 em mobile)
    const refreshMapBtn = document.getElementById('refreshMapBtn');
    if (refreshMapBtn) {
        refreshMapBtn.addEventListener('click', () => {
            refreshMapHard();
        });
    }

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

// ============================================================
// REFRESH DO MAPA (substitui F5 em mobile/tablet)
// ------------------------------------------------------------
// Faz um "soft reload" da aplicação sem recarregar a página:
//   • Re-renderiza todas as camadas visíveis (IndexedDB → mapa)
//   • Refresca eventos de fogo (CENSIPAM, se online)
//   • Limpa rota/linha traçada + popups abertos
//   • Reaplica o modo de visualização atual
//   • Zera marcador de origem (opcional, mantém se o usuário quiser)
//
// NÃO apaga: caches de tiles, cache de rotas, backup de camadas, dados
// de logradouros. Isso garante que o offline continue funcional.
// ============================================================
async function refreshMapHard() {
    const btn = document.getElementById('refreshMapBtn');
    if (btn?.disabled) return;   // já está rodando

    // Feedback visual
    if (btn) {
        btn.disabled = true;
        btn.classList.add('is-loading');
    }

    showToast('Recarregando mapa...', 'info', 2000);

    try {
        // 1. Limpa rota/linha/marcador de destino ativos
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

        // 2. Fecha popups abertos para evitar estado "fantasma"
        if (map) {
            try { map.closePopup(); } catch (_) {}
        }

        // 3. Invalida caches voláteis de UI
        if (typeof invalidateLayerCategoryCache === 'function') {
            invalidateLayerCategoryCache();
        }
        if (typeof invalidateStreetIndex === 'function') {
            invalidateStreetIndex();
        }

        // 4. Re-renderiza todas as camadas (IndexedDB → mapa)
        if (typeof reloadLayers === 'function') {
            await reloadLayers();
        }

        // 5. Refresca Eventos de Fogo (só se online; usa cache local se offline)
        if (typeof window.refreshEventosMG === 'function' && navigator.onLine) {
            try {
                await window.refreshEventosMG({ silent: true });
            } catch (e) {
                console.warn('[Refresh] Falha ao atualizar eventos:', e);
            }
        }

        // 6. Reaplica o filtro de visualização atual
        if (typeof setViewMode === 'function' && typeof viewMode === 'string') {
            setViewMode(viewMode);
        }

        // 7. Reinicializa overlays dependentes do DOM (idempotente)
        if (typeof updateMapChips === 'function') {
            await updateMapChips();
        }

        showToast('Mapa recarregado.', 'success', 1800);
    } catch (e) {
        console.error('[Refresh] Erro durante o refresh:', e);
        showToast('Falha ao recarregar o mapa.', 'error', 3000);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('is-loading');
        }
    }
}
window.refreshMapHard = refreshMapHard;

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
window.ensureOriginAvailable = ensureOriginAvailable;

// ============================================================
// MODO ESCURO / DARK THEME OPERACIONAL (COBOM)
// ============================================================
function initTheme() {
    const savedTheme = localStorage.getItem('cobom_theme') || 'light';
    const toggleBtn = document.getElementById('themeToggleBtn');

    function applyTheme(theme) {
        if (theme === 'dark') {
            document.body.classList.add('dark-theme');
            if (toggleBtn) {
                toggleBtn.textContent = '☀️';
                toggleBtn.title = 'Alternar para Modo Diurno';
            }
        } else {
            document.body.classList.remove('dark-theme');
            if (toggleBtn) {
                toggleBtn.textContent = '🌙';
                toggleBtn.title = 'Alternar para Modo Noturno (COBOM)';
            }
        }
        localStorage.setItem('cobom_theme', theme);
    }

    applyTheme(savedTheme);

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const isDark = document.body.classList.contains('dark-theme');
            applyTheme(isDark ? 'light' : 'dark');
            showToast(isDark ? 'Modo Diurno ativado.' : 'Modo Noturno (COBOM) ativado.', 'info', 1800);
        });
    }
}

// ============================================================
// ATALHOS DE TECLADO OPERACIONAIS (SALA DE DESPACHO 193)
// ============================================================
function initOperationalKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        const isEditing = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

        // F2 ou / (quando fora de digitação): Focar campo de busca
        if (e.key === 'F2' || (!isEditing && e.key === '/')) {
            e.preventDefault();
            const floatingInput = document.getElementById('floatingSearchInput');
            const searchInput = document.getElementById('searchInput');
            const sidebar = document.getElementById('sidebar');

            if (sidebar && !sidebar.classList.contains('collapsed') && searchInput) {
                searchInput.focus();
                searchInput.select();
            } else if (floatingInput) {
                floatingInput.focus();
                floatingInput.select();
            }
            return;
        }

        // Alt + G: Usar localização GPS
        if (e.altKey && (e.key === 'g' || e.key === 'G')) {
            e.preventDefault();
            const gpsBtn = document.getElementById('useMyLocationBtn');
            if (gpsBtn) gpsBtn.click();
            return;
        }

        // Alt + 1: Despacho rápido para a Unidade BM #1 (mais próxima)
        if (e.altKey && e.key === '1') {
            e.preventDefault();
            const topUnitCard = document.getElementById('dispatch-unit-card-0');
            if (topUnitCard) {
                topUnitCard.click();
                showToast('Despacho acionado para Unidade #1.', 'info', 2000);
            }
            return;
        }

        // Alt + N: Alternar Modo Noturno (COBOM) / Diurno
        if (e.altKey && (e.key === 'n' || e.key === 'N')) {
            e.preventDefault();
            const themeBtn = document.getElementById('themeToggleBtn');
            if (themeBtn) themeBtn.click();
            return;
        }

        // Alt + B: Alternar sidebar (drawer)
        if (e.altKey && (e.key === 'b' || e.key === 'B')) {
            e.preventDefault();
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            if (sidebar.classList.contains('collapsed')) {
                _openSidebar();
                localStorage.setItem('cobom_sidebar_state', 'open');
            } else {
                _closeSidebar();
                localStorage.setItem('cobom_sidebar_state', 'collapsed');
            }
            return;
        }

        // Ctrl+R / Cmd+R: Refresh do mapa (intercepta o F5 do browser)
        if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
            e.preventDefault();
            refreshMapHard();
            return;
        }

        // Escape: Fechar modais, limpar rotas ou fechar dropdown flutuante
        if (e.key === 'Escape') {
            // 1. Fecha modais visíveis
            const openModals = document.querySelectorAll('.modal:not(.hidden)');
            if (openModals.length > 0) {
                openModals.forEach(m => m.classList.add('hidden'));
                return;
            }

            // 2. Fecha dropdown de resultados da busca flutuante
            const floatingResults = document.getElementById('floatingSearchResults');
            if (floatingResults && !floatingResults.classList.contains('hidden')) {
                floatingResults.classList.add('hidden');
                return;
            }

            // 3. Se há rota ativa ou origem traçada, restaura visão inicial
            if (window.distanceLine || window.routingControl) {
                resetAll();
            }
        }
    });
}

// ============================================================
// MODAL DE ATALHOS OPERACIONAIS (COBOM 193)
// ============================================================
function initShortcutsModal() {
    const shortcutsBtn = document.getElementById('shortcutsBtn');
    const shortcutsModal = document.getElementById('shortcutsModal');
    const closeShortcutsModal = document.getElementById('closeShortcutsModal');

    if (shortcutsBtn && shortcutsModal) {
        shortcutsBtn.addEventListener('click', () => {
            shortcutsModal.classList.remove('hidden');
        });
    }

    if (closeShortcutsModal && shortcutsModal) {
        closeShortcutsModal.addEventListener('click', () => {
            shortcutsModal.classList.add('hidden');
        });
    }

    if (shortcutsModal) {
        // Fechar ao clicar fora do conteúdo
        shortcutsModal.addEventListener('click', (e) => {
            if (e.target === shortcutsModal) {
                shortcutsModal.classList.add('hidden');
            }
        });
    }
}


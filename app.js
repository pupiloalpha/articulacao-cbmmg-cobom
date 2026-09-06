/**
 * app.js - Ponto de entrada e controlador de interface da aplicação PWA COBOM/CBMMG
 */

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Inicializando COBOM Articulação BM PWA...');

    // 1. Inicializar Banco de Dados IndexedDB (db.js)
    if (window.dbManager) {
        await window.dbManager.init();
    }

    // 2. Inicializar Mapa Leaflet (map.js)
    if (window.mapManager) {
        window.mapManager.init();
    }

    // 3. Inicializar Gestão de Camadas (layers.js)
    if (window.layersManager) {
        await window.layersManager.init();
    }

    // 4. Configurar Ouvintes de Eventos da Interface (UI)
    setupUIEventListeners();

    // 5. Verificar Conectividade Inicial
    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    // 6. Registrar Service Worker PWA
    registerServiceWorker();
});

/**
 * Configura todos os ouvintes de eventos da interface
 */
function setupUIEventListeners() {
    // Alternância de Abas da Sidebar
    const tabButtons = document.querySelectorAll('.sidebar-tabs .tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetTab = e.currentTarget.getAttribute('data-tab');
            switchSidebarTab(targetTab);
        });
    });

    // Toggle da Sidebar (Mobile e Botão de Colapsar)
    const sidebar = document.getElementById('sidebar');
    const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
    const collapseSidebarBtn = document.getElementById('collapseSidebarBtn');

    if (toggleSidebarBtn) {
        toggleSidebarBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    if (collapseSidebarBtn) {
        collapseSidebarBtn.addEventListener('click', () => {
            sidebar.classList.add('collapsed');
        });
    }

    // Botão Rápido de Configurações/Admin no Cabeçalho
    const quickAdminBtn = document.getElementById('quickAdminBtn');
    if (quickAdminBtn) {
        quickAdminBtn.addEventListener('click', () => {
            switchSidebarTab('tab-admin');
        });
    }

    // Quick Action Chips
    const locateMeBtn = document.getElementById('locateMeBtn');
    const selectOnMapBtn = document.getElementById('selectOnMapBtn');
    const resetAllBtn = document.getElementById('resetAllBtn');

    if (locateMeBtn) {
        locateMeBtn.addEventListener('click', () => {
            if (window.mapManager) {
                window.mapManager.useGPSLocation();
            }
        });
    }

    if (selectOnMapBtn) {
        selectOnMapBtn.addEventListener('click', () => {
            if (window.mapManager) {
                window.mapManager.enableMapClickSelection();
                showToast('Clique em qualquer ponto do mapa para definir a origem.', 'info');
            }
        });
    }

    if (resetAllBtn) {
        resetAllBtn.addEventListener('click', () => {
            if (window.mapManager) {
                window.mapManager.resetOriginAndResults();
            }
            const addressInput = document.getElementById('addressInput');
            if (addressInput) addressInput.value = '';
            showToast('Origem e pesquisas limpas com sucesso.', 'info');
        });
    }

    // Busca de Endereço
    const searchBtn = document.getElementById('searchBtn');
    const addressInput = document.getElementById('addressInput');

    if (searchBtn && addressInput) {
        searchBtn.addEventListener('click', () => performAddressSearch());
        addressInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performAddressSearch();
            }
        });
    }

    // Modos de Visualização de Camadas
    const viewModeButtons = document.querySelectorAll('.view-mode-btn');
    viewModeButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            viewModeButtons.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const mode = e.currentTarget.getAttribute('data-mode');
            if (window.layersManager) {
                window.layersManager.setVisualizationMode(mode);
            }
        });
    });

    // Modais e Fechamento
    const closeModalButtons = document.querySelectorAll('.close-modal-btn');
    closeModalButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modalId = e.currentTarget.getAttribute('data-modal');
            const modal = document.getElementById(modalId);
            if (modal) modal.classList.add('hidden');
        });
    });

    // Trigger de Login
    const loginModalTriggerBtn = document.getElementById('loginModalTriggerBtn');
    if (loginModalTriggerBtn) {
        loginModalTriggerBtn.addEventListener('click', () => {
            const loginModal = document.getElementById('loginModal');
            if (loginModal) loginModal.classList.remove('hidden');
        });
    }
}

/**
 * Alterna dinamicamente entre as abas da barra lateral
 * @param {string} tabId ID da aba de destino (ex: 'tab-despacho', 'tab-camadas', 'tab-admin')
 */
function switchSidebarTab(tabId) {
    const buttons = document.querySelectorAll('.sidebar-tabs .tab-btn');
    const panes = document.querySelectorAll('.sidebar-tab-content .tab-pane');

    buttons.forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    panes.forEach(pane => {
        if (pane.id === tabId) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });
}

/**
 * Executa a busca por endereço digitado no campo unificado
 */
function performAddressSearch() {
    const input = document.getElementById('addressInput');
    if (!input || !input.value.trim()) return;

    const query = input.value.trim();
    if (window.mapManager) {
        // Assegura que o resultado redirecione a visualização para a aba de despacho
        switchSidebarTab('tab-despacho');
        window.mapManager.searchAndSetOrigin(query);
    }
}

/**
 * Atualiza o indicador visual de conectividade (Status Pill)
 */
function updateOnlineStatus() {
    const statusPill = document.getElementById('connectionStatusPill');
    if (!statusPill) return;

    const statusText = statusPill.querySelector('.status-text');

    if (navigator.onLine) {
        statusPill.classList.remove('offline');
        statusPill.classList.add('online');
        if (statusText) statusText.textContent = 'Online';
    } else {
        statusPill.classList.remove('online');
        statusPill.classList.add('offline');
        if (statusText) statusText.textContent = 'Offline';
    }
}

/**
 * Exibe notificações em formato Toast na tela
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3500);
}

/**
 * Registra o Service Worker da PWA
 */
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registrado com sucesso:', reg.scope))
            .catch(err => console.error('Falha ao registrar Service Worker:', err));
    }
}

// Exportações para escopo global
window.switchSidebarTab = switchSidebarTab;
window.showToast = showToast;
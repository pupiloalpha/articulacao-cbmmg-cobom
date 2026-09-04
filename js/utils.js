// js/utils.js - Funções utilitárias, auxílio de texto e notificações Toast

// Helper para remover acentos e converter para minúsculas
function normalizeStr(str) {
    if (!str) return '';
    return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// Extrai/constrói o nome completo do logradouro a partir das propriedades da feature
function getFeatureStreetName(props) {
    if (!props) return '';

    // Formato padrão do IBGE (rmbh.geojson e similares)
    if (props.NM_LOG) {
        const parts = [props.NM_TIP_LOG, props.NM_TIT_LOG, props.NM_LOG].filter(Boolean);
        return parts.join(' ');
    }

    // Outras propriedades comuns de logradouro
    return props.NM_LOGRADOURO || 
           props.logradouro || 
           props.nome || 
           props.name || 
           props.LOGRADOURO || 
           props.RUAS || 
           '';
}

// Função utilitária de notificações Toast (não bloqueantes)
function showToast(message, type = 'info', duration = 3000) {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Indicador de status online/offline
function updateOnlineStatus() {
    const indicator = document.getElementById('status-indicator');
    if (!indicator) return;
    if (navigator.onLine) {
        indicator.textContent = 'Online';
        indicator.className = 'status-indicator online';
    } else {
        indicator.textContent = 'Offline';
        indicator.className = 'status-indicator offline';
    }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// Helpers para cálculos de coordenadas de Tiles
function getTileBoundsForZoom(bounds, zoom) {
    const nw = bounds.getNorthWest();
    const se = bounds.getSouthEast();
    const minX = long2tile(nw.lng, zoom);
    const maxX = long2tile(se.lng, zoom);
    const minY = lat2tile(se.lat, zoom);
    const maxY = lat2tile(nw.lat, zoom);
    return { minX, maxX, minY, maxY };
}

function long2tile(lon, zoom) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
    return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
}

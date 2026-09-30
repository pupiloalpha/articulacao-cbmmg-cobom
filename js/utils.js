// js/utils.js - Utilitários gerais (normalização, municípios, toast, tiles)
// + Delegação de eventos (data-cobom-action) + escapeHtml global

// ===========================================================================
// BIBLIOTECA CENTRAL DE ÍCONES SVG (Feather-style)
// ---------------------------------------------------------------------------
// Substitui TODOS os emojis do PWA por SVG stroke-based (currentColor),
// garantindo:
//   • Renderização idêntica em todos os sistemas operacionais
//   • Controle total de cor (tinta institucional por categoria)
//   • Escala vetorial nítida em qualquer DPI
//   • Consistência com a iconografia já usada em layers.js / icons.js
//
// Uso: svgIcon('search', 16)  →  <svg class="ui-icon" …>…</svg>
//      svgIcon('pin', 20, 'meu-classe')
// ===========================================================================
const SVG_ICON_PATHS = {
    // ---- Navegação / UI ----
    'search':        '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    'pin':           '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    'target':        '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    'crosshair':     '<circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/>',
    'trash':         '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    'lock':          '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'unlock':        '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    'sun':           '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    'moon':          '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    'menu':          '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    'refresh':       '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    'keyboard':      '<rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6.01" y2="10"/><line x1="10" y1="10" x2="10.01" y2="10"/><line x1="14" y1="10" x2="14.01" y2="10"/><line x1="18" y1="10" x2="18.01" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/>',
    'check':         '<polyline points="20 6 9 17 4 12"/>',
    'x':             '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    'plus':          '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    'edit':          '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    'copy':          '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    'eye':           '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off':       '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
    'chevron-up':    '<polyline points="18 15 12 9 6 15"/>',
    'chevron-down':  '<polyline points="6 9 12 15 18 9"/>',
    'arrow-right':   '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    'alert':         '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    'info':          '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    'shield':        '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    'map':           '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
    'globe':         '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    'download':      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    'upload':        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    'star':          '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    'clock':         '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'phone':         '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    'compass':       '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    'route':         '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
    'truck':         '<rect x="1" y="6" width="14" height="11" rx="1.5"/><path d="M15 9h4l3 3v5h-7V9z"/><circle cx="6.5" cy="18.5" r="1.8"/><circle cx="17.5" cy="18.5" r="1.8"/>',
    'hospital':      '<rect x="3" y="3" width="18" height="18" rx="2.5"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
    'flame':         '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    'droplet':       '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
    'hash':          '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    'zap':           '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    'wifi':          '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
    'wifi-off':      '<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
    'save':          '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    'code':          '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    'layers':        '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    'package':       '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    'file':          '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
    'upload-cloud':  '<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>',
    'trending-up':   '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    'trending-down': '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>',
    'plus-circle':   '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
    'maximize':      '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    'crosshair-shuffle': '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
    'chevron-left':  '<polyline points="15 18 9 12 15 6"/>'
};

/**
 * Gera um SVG inline a partir da biblioteca central.
 *
 * @param {string} name       Chave em SVG_ICON_PATHS
 * @param {number} [size=16]  Largura/altura em px
 * @param {string} [extraClass=''] Classe CSS adicional
 * @returns {string} HTML do SVG
 */
function svgIcon(name, size = 16, extraClass = '') {
    const inner = SVG_ICON_PATHS[name];
    if (!inner) return '';
    const cls = extraClass ? `ui-icon ${extraClass}` : 'ui-icon';
    return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

window.SVG_ICON_PATHS = SVG_ICON_PATHS;
window.svgIcon = svgIcon;

// Dicionário de Códigos IBGE de Municípios de Minas Gerais (RMBH + principais sedes)
const IBGE_MUNICIPALITIES = {
    '3156700': 'Sabará',
    '3106200': 'Belo Horizonte',
    '3106705': 'Betim',
    '3118601': 'Contagem',
    '3144805': 'Nova Lima',
    '3157807': 'Santa Luzia',
    '3171204': 'Vespasiano',
    '3129806': 'Ibirité',
    '3154606': 'Ribeirão das Neves',
    '3109006': 'Brumadinho',
    '3114303': 'Caeté',
    '3124104': 'Esmeraldas',
    '3130101': 'Igarapé',
    '3132206': 'Itabirito',
    '3136652': 'Juatuba',
    '3137601': 'Lagoa Santa',
    '3140159': 'Mário Campos',
    '3140704': 'Mateus Leme',
    '3149309': 'Pedro Leopoldo',
    '3153905': 'Raposos',
    '3155306': 'Rio Acima',
    '3157906': 'Santana do Riacho',
    '3158953': 'São Joaquim de Bicas',
    '3159308': 'São José da Lapa',
    '3157609': 'Sarzedo',
    '3159605': 'Sete Lagoas',
    '3100104': 'Abadia dos Dourados',
    '3100203': 'Abaeté',
    '3100302': 'Abre Campo',
    '3100609': 'Água Boa',
    '3100708': 'Água Comprida',
    '3100807': 'Aguanil',
    '3100906': 'Águas Formosas',
    '3101409': 'Albertina',
    '3101508': 'Além Paraíba',
    '3101631': 'Alfredo Vasconcelos',
    '3103207': 'Araçaí',
    '3103504': 'Araguari',
    '3106655': 'Berizal',
    '3107901': 'Bom Repouso',
    '3115359': 'Catas Altas',
    '3122306': 'Divinópolis',
    '3126109': 'Formiga',
    '3120904': 'Curvelo',
    '3105103': 'Bambuí',
    '3104007': 'Araxá',
    '3105608': 'Barbacena',
    '3170206': 'Uberlândia',
    '3170107': 'Uberaba',
    '3143302': 'Montes Claros',
    '3136702': 'Juiz de Fora',
    '3127701': 'Governador Valadares',
    '3131307': 'Ipatinga',
    '3148004': 'Patos de Minas',
    '3151800': 'Poços de Caldas',
    '3152501': 'Pouso Alegre',
    '3168606': 'Teófilo Otoni',
    '3169307': 'Três Corações',
    '3170701': 'Varginha',
    '3139409': 'Manhuaçu',
    '3152105': 'Ponte Nova'
};

// ===========================================================================
// SANITIZAÇÃO — escapeHtml global (consolidado; usado por search.js,
// admin.js, layers.js, map.js, etc.)
// ---------------------------------------------------------------------------
// Implementação única via regex + mapa de substituição (mais rápido que
// 5 .replace encadeados). Escapa os 5 caracteres críticos em HTML:
//   & < > " '  →  &amp; &lt; &gt; &quot; &#39;
// É seguro tanto para conteúdo de elementos quanto para valores de
// atributos HTML delimitados por " ou '.
// ===========================================================================
const _ESCAPE_HTML_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, c => _ESCAPE_HTML_MAP[c]);
}

// ===========================================================================
// DELEGAÇÃO DE EVENTOS — substitui onclick inline (CSP hardening)
// ---------------------------------------------------------------------------
// Todos os botões gerados dinamicamente em popups, tooltips e cards de
// despacho usam data-cobom-action + data-* para se comunicarem com este
// handler único, eliminando a necessidade de 'unsafe-inline' no CSP.
//
// Uso: <button data-cobom-action="acao" data-param1="..." data-param2="...">
//
// ⚠️ O listener é instalado em CAPTURE PHASE. Isso garante que ele
// intercepte o clique ANTES que o Leaflet o processe (o Leaflet escuta
// eventos no popup-wrapper e pode interromper a propagação). Ao chamar
// stopPropagation() em capture, o evento não atinge o alvo nem borbulha.
// ===========================================================================
function initCobomActionDelegation() {
    // Idempotente — evita dupla instalação.
    if (window.__cobomActionDelegationInstalled) return;
    window.__cobomActionDelegationInstalled = true;

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cobom-action]');
        if (!btn) return;

        const action = btn.dataset.cobomAction;
        if (!action) return;

        // Interrompe propagação para evitar handlers paralelos do Leaflet.
        e.stopPropagation();
        e.preventDefault();

        try {
            switch (action) {
                case 'close-popup':
                    if (typeof map !== 'undefined' && map) map.closePopup();
                    return;

                case 'edit-feature': {
                    const layerId = Number(btn.dataset.layerId);
                    const featureIndex = Number(btn.dataset.featureIndex);
                    if (!Number.isFinite(layerId) || !Number.isFinite(featureIndex)) return;
                    if (typeof window.openEditFeatureModal === 'function') {
                        window.openEditFeatureModal(layerId, featureIndex);
                    }
                    return;
                }

                case 'set-origin': {
                    const lat = parseFloat(btn.dataset.lat);
                    const lng = parseFloat(btn.dataset.lng);
                    const name = btn.dataset.name || 'Ponto';
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
                    if (typeof window.setOriginFromFeature === 'function') {
                        window.setOriginFromFeature(lat, lng, name);
                    }
                    return;
                }

                case 'route-to': {
                    const lng = parseFloat(btn.dataset.lng);
                    const lat = parseFloat(btn.dataset.lat);
                    const name = btn.dataset.name || 'Destino';
                    const reverse = btn.dataset.reverse === 'true';
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
                    if (typeof window.routeToFeature === 'function') {
                        window.routeToFeature(lng, lat, name, reverse);
                    }
                    return;
                }

                case 'copy-coords': {
                    const lat = parseFloat(btn.dataset.lat);
                    const lng = parseFloat(btn.dataset.lng);
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
                    if (typeof window.copyFeatureCoords === 'function') {
                        window.copyFeatureCoords(lat, lng);
                    }
                    return;
                }

                case 'open-external': {
                    const url = btn.dataset.url;
                    if (!url) return;
                    // Defense-in-depth: só http(s). Bloqueia javascript:, data:, vbscript:.
                    if (!/^https?:\/\//i.test(url)) {
                        console.warn('[COBOM] URL bloqueada (não http/https):', url);
                        return;
                    }
                    window.open(url, '_blank', 'noopener,noreferrer');
                    return;
                }

                case 'focus-feature': {
                    const lng = parseFloat(btn.dataset.lng);
                    const lat = parseFloat(btn.dataset.lat);
                    const name = btn.dataset.name || 'Destino';
                    const distance = parseFloat(btn.dataset.distance) || 0;
                    const reverse = btn.dataset.reverse === 'true';
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
                    if (typeof focusOnFeature === 'function') {
                        focusOnFeature(lng, lat, name, distance, reverse);
                    }
                    return;
                }

                default:
                    // Ação desconhecida — silencioso (não quebra o app).
                    return;
            }
        } catch (err) {
            console.warn(`[COBOM Action] Erro em "${action}":`, err);
        }
    }, true); // <-- CAPTURE PHASE
}

// Instala imediatamente. `document` já existe quando este script executa,
// mesmo com <script defer> (que roda após o parse do HTML).
initCobomActionDelegation();

/**
 * Obtém o nome do município a partir do código IBGE ou código de setor censitário
 */
function getMunicipalityName(cdSetorOrCdMun) {
    if (!cdSetorOrCdMun) return '';
    const codeStr = String(cdSetorOrCdMun).replace(/\D/g, '');
    const prefix7 = codeStr.slice(0, 7);
    const prefix6 = codeStr.slice(0, 6);

    if (IBGE_MUNICIPALITIES[prefix7]) return IBGE_MUNICIPALITIES[prefix7];
    if (IBGE_MUNICIPALITIES[prefix6 + '0']) return IBGE_MUNICIPALITIES[prefix6 + '0'];

    for (const [code, name] of Object.entries(IBGE_MUNICIPALITIES)) {
        if (code.startsWith(prefix6) || prefix7.startsWith(code.slice(0, 6))) {
            return name;
        }
    }
    return '';
}

/**
 * Extrai o nome do município a partir do nome da camada
 */
function getMunicipalityFromLayerName(layerName) {
    if (!layerName) return '';
    return String(layerName)
        .replace(/\s*-\s*Logradouros$/i, '')
        .replace(/\s*-\s*Ruas$/i, '')
        .replace(/\s*RMBH.*/i, 'RMBH')
        .trim();
}

/**
 * Helper para remover acentos, pontuação e converter para minúsculas
 */
function normalizeStr(str) {
    if (!str) return '';
    return String(str)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .trim();
}

/**
 * Expande abreviações comuns da língua portuguesa para busca precisa
 */
function expandSearchQuery(query) {
    if (!query) return '';
    let q = ' ' + normalizeStr(query) + ' ';

    const replacements = [
        [/\bav\b\.?/g, 'avenida'],
        [/\bavd\b\.?/g, 'avenida'],
        [/\br\b\.?/g, 'rua'],
        [/\bpc\b\.?/g, 'praca'],
        [/\bpca\b\.?/g, 'praca'],
        [/\btrv\b\.?/g, 'travessa'],
        [/\btrav\b\.?/g, 'travessa'],
        [/\bal\b\.?/g, 'alameda'],
        [/\bdr\b\.?/g, 'doutor'],
        [/\bdra\b\.?/g, 'doutora'],
        [/\bpe\b\.?/g, 'padre'],
        [/\bsto\b\.?/g, 'santo'],
        [/\bsta\b\.?/g, 'santa'],
        [/\bns\b\.?/g, 'nossa senhora'],
        [/\bpref\b\.?/g, 'prefeito'],
        [/\bver\b\.?/g, 'vereador'],
        [/\bprof\b\.?/g, 'professor'],
        [/\bprofa\b\.?/g, 'professora'],
        [/\bexp\b\.?/g, 'expedicionario'],
        [/\bcel\b\.?/g, 'coronel'],
        [/\bten\b\.?/g, 'tenente'],
        [/\bcap\b\.?/g, 'capitao'],
        [/\bmaj\b\.?/g, 'major'],
        [/\bsgt\b\.?/g, 'sargento'],
        [/\best\b\.?/g, 'estrada'],
        [/\brod\b\.?/g, 'rodovia']
    ];

    for (const [regex, replacement] of replacements) {
        q = q.replace(regex, replacement);
    }

    return q.trim();
}

/**
 * Extrai/constrói informações estruturadas do logradouro
 */
function getFeatureStreetInfo(props, layerName = '') {
    if (!props) return null;

    let fullName = '';
    let streetOnly = '';
    let tipLog = props.NM_TIP_LOG || '';
    let titLog = props.NM_TIT_LOG || '';

    let munName = getMunicipalityName(props.CD_SETOR || props.CD_MUN);

    if (!munName && layerName) {
        munName = getMunicipalityFromLayerName(layerName);
    }

    if (props.NM_LOG) {
        streetOnly = String(props.NM_LOG).trim();
        const parts = [tipLog, titLog, streetOnly].filter(Boolean);
        fullName = parts.join(' ');
    } else {
        fullName = props.NM_LOGRADOURO ||
                   props.logradouro ||
                   props.nome ||
                   props.name ||
                   props.LOGRADOURO ||
                   props.RUAS ||
                   '';
        streetOnly = fullName;
    }

    if (!fullName) return null;

    return {
        fullName: fullName.trim(),
        streetOnly: streetOnly.trim(),
        tipLog: (tipLog || '').trim(),
        titLog: (titLog || '').trim(),
        munName: munName || 'MG',
        totalRes: Number(props.TOT_RES) || 0,
        totalGeral: Number(props.TOT_GERAL) || 0,
        cdSetor: props.CD_SETOR || ''
    };
}

function getFeatureStreetName(props, layerName = '') {
    const info = getFeatureStreetInfo(props, layerName);
    return info ? info.fullName : '';
}

/**
 * Notificações Toast (não bloqueantes)
 */
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

/**
 * Indicador de status online/offline
 */
function updateOnlineStatus() {
    const indicator = document.getElementById('status-indicator');
    if (!indicator) return;
    if (navigator.onLine) {
        indicator.innerHTML = '<span class="status-dot"></span> Online (Tiles & Rotas)';
        indicator.className = 'status-indicator online';
        indicator.title = 'Conectado à internet. Tiles dinâmicos e cálculo de rotas viárias OSRM disponíveis.';
    } else {
        indicator.innerHTML = '<span class="status-dot"></span> Modo Offline (Dados Locais)';
        indicator.className = 'status-indicator offline';
        indicator.title = 'Sem conexão externa. Operando 100% com dados e tiles em cache local.';
    }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

/**
 * Helpers para cálculos de coordenadas de Tiles
 */
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
    return Math.floor(
        (1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) /
            2 *
            Math.pow(2, zoom)
    );
}

/**
 * Parse de endereço com número + interpolação aproximada em faces de logradouro
 */
function parseAddressQuery(query) {
    if (!query) return { streetPart: '', number: null, hasNumber: false };

    let q = String(query).trim();
    q = q.replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();

    const numberRegex = /(?:n[ºo°.]?\s*|num\.?\s*|n\s+)?(\d{1,5})\s*$/i;
    const match = q.match(numberRegex);

    let number = null;
    let streetPart = q;

    if (match) {
        number = parseInt(match[1], 10);
        streetPart = q.slice(0, match.index).trim();
        streetPart = streetPart.replace(/(?:n[ºo°.]?\s*|num\.?\s*|n\s+)$/i, '').trim();
    }

    const normalizedStreet = expandSearchQuery(streetPart);

    return {
        streetPart: normalizedStreet,
        originalStreet: streetPart,
        number,
        hasNumber: number !== null && !isNaN(number) && number > 0
    };
}

/**
 * Interpola um ponto aproximado ao longo dos segmentos de uma rua
 */
function interpolatePointOnStreet(features, number, totalRes) {
    if (!features || features.length === 0 || !number || number < 1) return null;
    if (typeof turf === 'undefined') return null;

    const estimatedCapacity = Math.max(
        (totalRes > 0 ? totalRes * 2 : 0),
        features.length * 8,
        20
    );

    if (number > estimatedCapacity * 1.4) {
        return null;
    }

    const segments = [];
    let totalLength = 0;
    let totalWeight = 0;

    for (const f of features) {
        if (!f.geometry) continue;
        try {
            const length = turf.length(f, { units: 'meters' });
            if (length < 1) continue;

            const props = f.properties || {};
            const weight = (Number(props.TOT_RES) || 0) + (Number(props.TOT_GERAL) || 0) || length;

            segments.push({ feature: f, length, weight });
            totalLength += length;
            totalWeight += weight;
        } catch (e) {
            // ignora geometria inválida
        }
    }

    if (segments.length === 0 || totalLength < 1) return null;

    const ratio = Math.min(1, Math.max(0, (number - 1) / Math.max(estimatedCapacity - 1, 1)));

    let accumulated = 0;
    const target = ratio * (totalWeight > 0 ? totalWeight : totalLength);

    for (const seg of segments) {
        const segWeight = totalWeight > 0 ? seg.weight : seg.length;
        if (accumulated + segWeight >= target) {
            const localRatio = segWeight > 0
                ? (target - accumulated) / segWeight
                : 0.5;

            try {
                const along = turf.along(seg.feature, localRatio * seg.length, { units: 'meters' });
                const [lng, lat] = along.geometry.coordinates;
                return { lat, lng };
            } catch (e) {
                try {
                    const center = turf.center(seg.feature);
                    return {
                        lat: center.geometry.coordinates[1],
                        lng: center.geometry.coordinates[0]
                    };
                } catch (_) {
                    return null;
                }
            }
        }
        accumulated += segWeight;
    }

    const last = segments[segments.length - 1];
    try {
        const along = turf.along(last.feature, last.length * 0.95, { units: 'meters' });
        return {
            lat: along.geometry.coordinates[1],
            lng: along.geometry.coordinates[0]
        };
    } catch (_) {
        return null;
    }
}

/**
 * Dado um streetKey (ou nome + município), retorna todas as features
 */
async function getStreetFeaturesByKey(streetKeyOrName, munName = '') {
    const layers = await DB.getLayers();
    const result = [];
    const targetNorm = normalizeStr(streetKeyOrName);
    const munNorm = normalizeStr(munName);

    for (const layer of layers) {
        if (!layer?.geojson?.features) continue;
        if (!layer.name || !(layer.name.includes('Logradouros') || layer.name.includes('Ruas'))) continue;

        for (const feature of layer.geojson.features) {
            const info = getFeatureStreetInfo(feature.properties, layer.name);
            if (!info?.fullName) continue;

            const fullNorm = normalizeStr(info.fullName);
            const munMatch = !munNorm || normalizeStr(info.munName).includes(munNorm) || munNorm.includes(normalizeStr(info.munName));

            if (munMatch && (fullNorm === targetNorm || fullNorm.includes(targetNorm) || targetNorm.includes(fullNorm))) {
                result.push(feature);
            }
        }
    }
    return result;
}
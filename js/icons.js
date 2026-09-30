// js/icons.js — Ícones SVG/HTML específicos por tipo de feição
// Substitui o uso de circleMarker por marcadores coloridos com SVG inline,
// garantindo renderização idêntica em todos os sistemas operacionais.

/**
 * Configuração central de ícones por classificação de feição.
 *
 * Cada tipo tem:
 *   • svg     → conteúdo SVG inline (stroke ou fill, herdando currentColor
 *               como #ffffff quando aplicado sobre fundo colorido)
 *   • bg      → cor de fundo do círculo do pin
 *   • border  → cor da borda
 *   • label   → rótulo na legenda
 *   • size    → diâmetro em px
 *
 * ⚠️ HIDRANTE mantém o SVG detalhado de hidrante de coluna (mais informativo
 *    que uma gota d'água genérica). Os demais usam SVG Feather-style.
 */
const FEATURE_ICON_CONFIG = {
    UNIDADE_BM: {
        // Caminhão de bombeiros — silhueta com cabine e rodas
        svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="1" y="7" width="13" height="10" rx="1.5"/>
            <path d="M14 10h4l3 3v4h-7V10z"/>
            <circle cx="6" cy="19" r="1.8"/>
            <circle cx="17" cy="19" r="1.8"/>
        </svg>`,
        bg: '#c0392b',
        border: '#7b241c',
        label: 'Unidade BM',
        description: 'Fração / unidade do Corpo de Bombeiros',
        size: 36
    },
    HOSPITAL: {
        // Cruz médica em quadrado arredondado
        svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2.5"/>
            <line x1="12" y1="8" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>`,
        bg: '#2980b9',
        border: '#1a5276',
        label: 'Hospital',
        description: 'Hospital de referência',
        size: 36
    },
    UPA: {
        // Ambulância — mesma linguagem do caminhão + cruz
        svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="1" y="7" width="13" height="10" rx="1.5"/>
            <path d="M14 10h4l3 3v4h-7V10z"/>
            <circle cx="6" cy="19" r="1.8"/>
            <circle cx="17" cy="19" r="1.8"/>
            <line x1="5" y1="11" x2="10" y2="11"/>
            <line x1="7.5" y1="9" x2="7.5" y2="13"/>
        </svg>`,
        bg: '#16a085',
        border: '#0e6655',
        label: 'UPA',
        description: 'Unidade de Pronto Atendimento',
        size: 36
    },
    HIDRANTE: {
        // SVG detalhado de hidrante de coluna (bonnet + dois braços + base
        // flangeada). Mais informativo que uma gota d'água genérica.
        svg: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
            <rect x="13.2" y="2.1" width="5.6" height="2.2" rx="0.7" fill="#0e3d5c"/>
            <path d="M11.4 9 Q11.4 4.8 16 4.3 Q20.6 4.8 20.6 9 Z" fill="#2e86c1"/>
            <rect x="11.4" y="8.6" width="9.2" height="1.5" fill="#1f618d"/>
            <rect x="6.6" y="13.2" width="5.2" height="3" rx="0.8" fill="#0e3d5c"/>
            <rect x="6.6" y="13.4" width="1.3" height="2.6" rx="0.4" fill="#1f618d"/>
            <rect x="20.2" y="13.2" width="5.2" height="3" rx="0.8" fill="#0e3d5c"/>
            <rect x="24.1" y="13.4" width="1.3" height="2.6" rx="0.4" fill="#1f618d"/>
            <rect x="11.7" y="9.4" width="8.6" height="17" rx="0.4" fill="#1f618d"/>
            <circle cx="16" cy="14.6" r="2.1" fill="#2e86c1" stroke="#0e3d5c" stroke-width="0.7"/>
            <circle cx="16" cy="14.6" r="0.7" fill="#0e3d5c"/>
            <rect x="9.1" y="26" width="13.8" height="3" rx="0.7" fill="#0e3d5c"/>
            <rect x="9.5" y="26.3" width="13" height="0.6" fill="#2e86c1" opacity="0.55"/>
            <rect x="12.4" y="10.4" width="1.2" height="15.6" rx="0.3" fill="#5499c7" opacity="0.55"/>
        </svg>`,
        bg: '#eaf2f8',
        border: '#1f618d',
        label: 'Hidrante',
        description: 'Hidrante de incêndio urbano',
        size: 36
    },
    EVENTO_FOGO: {
        // Chama
        svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
        </svg>`,
        bg: '#e67e22',
        border: '#a04000',
        label: 'Evento de Fogo',
        description: 'Foco de incêndio monitorado',
        size: 34
    },
    CHAMADA: {
        // Sirene / alarme — círculo com raios
        svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3a7 7 0 0 0-7 7v5l-2 3h18l-2-3v-5a7 7 0 0 0-7-7z"/>
            <path d="M10 21a2 2 0 0 0 4 0"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="3" y1="5" x2="4.5" y2="6.5"/>
            <line x1="21" y1="5" x2="19.5" y2="6.5"/>
        </svg>`,
        bg: '#e74c3c',
        border: '#922b21',
        label: 'Chamada CBMMG',
        description: 'Chamada operacional em andamento / finalizada',
        size: 34
    },
    MACRORREGIAO: {
        // Cruz médica em escudo
        svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <line x1="12" y1="8" x2="12" y2="15"/>
            <line x1="8.5" y1="11.5" x2="15.5" y2="11.5"/>
        </svg>`,
        bg: '#8e44ad',
        border: '#6c3483',
        label: 'Macrorregião',
        description: 'Macrorregião de Saúde',
        size: 34
    },
    MICRORREGIAO: {
        // Cruz médica em círculo (menor que macro)
        svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9"/>
            <line x1="12" y1="8" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>`,
        bg: '#27ae60',
        border: '#1e8449',
        label: 'Microrregião',
        description: 'Microrregião de Saúde',
        size: 34
    },
    POLYGON: {
        // Escudo com check (área territorial)
        svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <polyline points="9 12 11 14 15.5 9.5"/>
        </svg>`,
        bg: '#0288d1',
        border: '#01579b',
        label: 'Articulação',
        description: 'Polígono de articulação territorial',
        size: 34
    },
    POI: {
        // Marcador genérico (pin)
        svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
        </svg>`,
        bg: '#8e44ad',
        border: '#6c3483',
        label: 'POI',
        description: 'Ponto de interesse genérico',
        size: 34
    },
    DEFAULT: {
        svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
        </svg>`,
        bg: '#e74c3c',
        border: '#962d22',
        label: 'Outros',
        description: 'Feição não classificada',
        size: 34
    }
};

// Cache de ícones Leaflet para evitar recriação (performance)
const _iconCache = new Map();

/**
 * Retorna o conteúdo interno de um "swatch" (bolinha com ícone).
 * Sempre SVG (não mais emoji).
 */
function _swatchInner(cfg, pxSize) {
    if (cfg.svg) {
        return `<span style="
            display:inline-flex;
            align-items:center;
            justify-content:center;
            width:${pxSize}px;
            height:${pxSize}px;
            line-height:1;
        ">${cfg.svg}</span>`;
    }
    return '';
}

/**
 * Retorna o tipo visual correto para uma feição.
 * Detecta UPA vs. Hospital dentro da classificação HOSPITAL.
 */
function resolveIconType(feature) {
    const type = typeof getFeatureClassification === 'function'
        ? getFeatureClassification(feature)
        : 'DEFAULT';

    if (type === 'HOSPITAL' && typeof isUPA === 'function' && isUPA(feature)) {
        return 'UPA';
    }
    if (type === 'OTHER' || !type) return 'DEFAULT';
    return FEATURE_ICON_CONFIG[type] ? type : 'DEFAULT';
}

/**
 * Cria (ou recupera do cache) um L.divIcon para o tipo informado.
 *
 * @param {string} type  - chave em FEATURE_ICON_CONFIG
 * @param {object} [opts]
 * @param {boolean} [opts.emphasis] - destaca (hover) aumentando escala
 * @param {string}  [opts.badge]    - texto pequeno no canto (ex.: prioridade)
 */
function createFeatureIcon(type, opts = {}) {
    const cfg = FEATURE_ICON_CONFIG[type] || FEATURE_ICON_CONFIG.DEFAULT;
    const bg     = opts.bg     || cfg.bg;
    const border = opts.border || cfg.border;
    const emphasis = !!opts.emphasis;
    const badge    = opts.badge || '';
    const cacheKey = `${type}|${bg}|${border}|${emphasis ? 'hi' : 'lo'}|${badge}`;

    if (_iconCache.has(cacheKey)) return _iconCache.get(cacheKey);

    const size = Math.round(cfg.size * (emphasis ? 1.18 : 1));

    const badgeHtml = badge
        ? `<span class="pin-badge" style="
                position:absolute; top:-4px; right:-4px;
                background:#111; color:#fff;
                font-size:10px; font-weight:700;
                padding:1px 5px; border-radius:8px;
                box-shadow:0 1px 3px rgba(0,0,0,0.4);
                border:1.5px solid #fff;
                line-height:1.2;
            ">${badge}</span>`
        : '';

    const innerHtml = cfg.svg
        ? `<span class="pin-svg" style="
                width:${Math.round(size * 0.68)}px;
                height:${Math.round(size * 0.68)}px;
                display:flex;
                align-items:center;
                justify-content:center;
            ">${cfg.svg}</span>`
        : '';

    const html = `
        <div class="pin-marker" style="
            --pin-bg: ${bg};
            --pin-border: ${border};
            width: ${size}px;
            height: ${size}px;
        ">
            ${innerHtml}
            ${badgeHtml}
        </div>`;

    const icon = L.divIcon({
        className: 'feature-pin-wrapper',
        html,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2 + 4],
        tooltipAnchor: [0, -size / 2 - 4]
    });

    _iconCache.set(cacheKey, icon);
    return icon;
}

/**
 * Constrói a lista de tipos únicos presentes nas camadas carregadas
 * para montar a legenda dinâmica.
 */
async function collectPresentIconTypes() {
    const seen = new Set();
    try {
        const layers = await DB.getLayers();
        for (const layer of layers) {
            if (!layer?.geojson?.features) continue;
            for (const f of layer.geojson.features) {
                if (f.geometry?.type !== 'Point') continue;
                seen.add(resolveIconType(f));
            }
        }
    } catch (e) {
        console.warn('Erro ao coletar tipos para legenda:', e);
    }
    if (seen.size === 0) {
        Object.keys(FEATURE_ICON_CONFIG).forEach(k => {
            if (k !== 'DEFAULT') seen.add(k);
        });
    }
    return Array.from(seen);
}

/**
 * Renderiza a legenda na sidebar.
 */
async function renderLegend() {
    const ul = document.getElementById('legendUl');
    if (!ul) return;

    const types = await collectPresentIconTypes();
    const order = ['UNIDADE_BM', 'HOSPITAL', 'UPA', 'HIDRANTE', 'EVENTO_FOGO',
                   'MACRORREGIAO', 'MICRORREGIAO', 'POLYGON', 'POI', 'DEFAULT'];

    types.sort((a, b) => order.indexOf(a) - order.indexOf(b));

    ul.innerHTML = types.map(type => {
        const cfg = FEATURE_ICON_CONFIG[type] || FEATURE_ICON_CONFIG.DEFAULT;
        return `
            <li class="legend-item" title="${cfg.description}">
                <span class="legend-swatch" style="
                    background:${cfg.bg};
                    border-color:${cfg.border};
                ">${_swatchInner(cfg, 16)}</span>
                <span class="legend-label">${cfg.label}</span>
            </li>
        `;
    }).join('');
}

// ---------------------------------------------------------------------------
// Ícones compactos para a LISTA DE CAMADAS
// ---------------------------------------------------------------------------

function getLayerIconTypes(layer) {
    const types = new Set();
    if (!layer?.geojson?.features?.length) return ['DEFAULT'];

    for (const f of layer.geojson.features) {
        if (f.geometry?.type === 'Point') {
            types.add(resolveIconType(f));
        }
    }

    if (types.size === 0) {
        for (const f of layer.geojson.features) {
            const t = typeof getFeatureClassification === 'function'
                ? getFeatureClassification(f)
                : 'DEFAULT';
            if (t === 'MACRORREGIAO' || t === 'MICRORREGIAO' ||
                t === 'POLYGON' || t === 'EVENTO_FOGO') {
                types.add(t);
            }
        }
    }

    return types.size > 0 ? Array.from(types) : ['DEFAULT'];
}

/**
 * Monta o HTML da pilha de ícones de uma camada.
 * Mostra até `maxVisible` ícones; se houver mais, exibe "+N".
 */
function buildLayerIconHtml(layer, maxVisible = 3) {
    const types = getLayerIconTypes(layer);
    const visible = types.slice(0, maxVisible);
    const remaining = types.length - visible.length;

    const icons = visible.map(type => {
        const cfg = FEATURE_ICON_CONFIG[type] || FEATURE_ICON_CONFIG.DEFAULT;
        return `<span class="layer-icon-badge"
                      style="--layer-icon-bg:${cfg.bg}; --layer-icon-border:${cfg.border};"
                      title="${cfg.label}">${_swatchInner(cfg, 14)}</span>`;
    }).join('');

    const more = remaining > 0
        ? `<span class="layer-icon-more" title="${remaining} outro(s) tipo(s)">+${remaining}</span>`
        : '';

    return icons + more;
}


/**
 * Opções específicas por tipo (usadas em hover e casos especiais).
 */
function buildIconOptsForFeature(feature, emphasis = false) {
    const opts = { emphasis };
    const type = resolveIconType(feature);

    if (type === 'CHAMADA' && typeof getChamadaSituationStyle === 'function') {
        const st = getChamadaSituationStyle(feature.properties?.situacao);
        opts.bg = st.color;
        opts.border = st.border;
    }
    if (type === 'EVENTO_FOGO') {
        const indice = Number(feature.properties?.indice_prioridade);
        if (Number.isFinite(indice) && indice >= 0.7) opts.badge = '★';
    }
    return opts;
}

// Exporta globais
window.FEATURE_ICON_CONFIG   = FEATURE_ICON_CONFIG;
window.createFeatureIcon     = createFeatureIcon;
window.resolveIconType       = resolveIconType;
window.renderLegend          = renderLegend;

window.getLayerIconTypes  = getLayerIconTypes;
window.buildLayerIconHtml = buildLayerIconHtml;

window.buildIconOptsForFeature = buildIconOptsForFeature;
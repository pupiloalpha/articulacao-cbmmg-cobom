// js/icons.js — Ícones SVG/HTML específicos por tipo de feição
// Substitui o uso de circleMarker por marcadores coloridos com emoji,
// facilitando a leitura visual rápida do mapa operacional.

/**
 * Configuração central de ícones por classificação de feição.
 * Cada tipo tem cor de fundo, borda, emoji e tamanho.
 */
const FEATURE_ICON_CONFIG = {
    UNIDADE_BM: {
        emoji: '🚒',
        bg: '#c0392b',
        border: '#7b241c',
        label: 'Unidade BM',
        description: 'Fração / unidade do Corpo de Bombeiros',
        size: 36
    },
    HOSPITAL: {
        emoji: '🏥',
        bg: '#2980b9',
        border: '#1a5276',
        label: 'Hospital',
        description: 'Hospital de referência',
        size: 36
    },
    UPA: {
        emoji: '🚑',
        bg: '#16a085',
        border: '#0e6655',
        label: 'UPA',
        description: 'Unidade de Pronto Atendimento',
        size: 36
    },
    EVENTO_FOGO: {
        emoji: '🔥',
        bg: '#e67e22',
        border: '#a04000',
        label: 'Evento de Fogo',
        description: 'Foco de incêndio monitorado',
        size: 34
    },
    MACRORREGIAO: {
        emoji: '🏥',
        bg: '#8e44ad',
        border: '#6c3483',
        label: 'Macrorregião',
        description: 'Macrorregião de Saúde',
        size: 34
    },
    MICRORREGIAO: {
        emoji: '🟢',
        bg: '#27ae60',
        border: '#1e8449',
        label: 'Microrregião',
        description: 'Microrregião de Saúde',
        size: 34
    },
    POLYGON: {
        emoji: '🛡️',
        bg: '#0288d1',
        border: '#01579b',
        label: 'Articulação',
        description: 'Polígono de articulação territorial',
        size: 34
    },
    POI: {
        emoji: '📍',
        bg: '#8e44ad',
        border: '#6c3483',
        label: 'POI',
        description: 'Ponto de interesse genérico',
        size: 34
    },
    DEFAULT: {
        emoji: '📍',
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
    const emphasis = !!opts.emphasis;
    const badge = opts.badge || '';
    const cacheKey = `${type}|${emphasis ? 'hi' : 'lo'}|${badge}`;

    if (_iconCache.has(cacheKey)) return _iconCache.get(cacheKey);

    const size = Math.round(cfg.size * (emphasis ? 1.18 : 1));
    const emojiSize = Math.round(size * 0.5);

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

    const html = `
        <div class="pin-marker" style="
            --pin-bg: ${cfg.bg};
            --pin-border: ${cfg.border};
            width: ${size}px;
            height: ${size}px;
        ">
            <span class="pin-emoji" style="font-size:${emojiSize}px;">${cfg.emoji}</span>
            ${badgeHtml}
        </div>
    `;

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
    // Garante ao menos os tipos principais se houver pontos
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
    // Ordem preferencial
    const order = ['UNIDADE_BM', 'HOSPITAL', 'UPA', 'EVENTO_FOGO',
                   'MACRORREGIAO', 'MICRORREGIAO', 'POLYGON', 'POI', 'DEFAULT'];

    types.sort((a, b) => order.indexOf(a) - order.indexOf(b));

    ul.innerHTML = types.map(type => {
        const cfg = FEATURE_ICON_CONFIG[type] || FEATURE_ICON_CONFIG.DEFAULT;
        return `
            <li class="legend-item" title="${cfg.description}">
                <span class="legend-swatch" style="
                    background:${cfg.bg};
                    border-color:${cfg.border};
                ">${cfg.emoji}</span>
                <span class="legend-label">${cfg.label}</span>
            </li>
        `;
    }).join('');
}


// ---------------------------------------------------------------------------
// Ícones compactos para a LISTA DE CAMADAS
// ---------------------------------------------------------------------------

/**
 * Analisa uma camada e retorna os tipos de ícones presentes nela.
 * - Se houver pontos, prioriza os tipos de ponto.
 * - Se só houver polígonos, usa tipos de polígono.
 * - Se vazia, retorna ['DEFAULT'].
 */
function getLayerIconTypes(layer) {
    const types = new Set();
    if (!layer?.geojson?.features?.length) return ['DEFAULT'];

    // 1ª passada: pontos (têm prioridade visual)
    for (const f of layer.geojson.features) {
        if (f.geometry?.type === 'Point') {
            types.add(resolveIconType(f));
        }
    }

    // 2ª passada: se não houver pontos, considera polígonos
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
                      title="${cfg.label}">${cfg.emoji}</span>`;
    }).join('');

    const more = remaining > 0
        ? `<span class="layer-icon-more" title="${remaining} outro(s) tipo(s)">+${remaining}</span>`
        : '';

    return icons + more;
}

// Exporta globais
window.FEATURE_ICON_CONFIG   = FEATURE_ICON_CONFIG;
window.createFeatureIcon     = createFeatureIcon;
window.resolveIconType       = resolveIconType;
window.renderLegend          = renderLegend;

window.getLayerIconTypes  = getLayerIconTypes;
window.buildLayerIconHtml = buildLayerIconHtml;

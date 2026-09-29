// js/utils.js - Utilitários gerais (normalização, municípios, toast, tiles)
// + Delegação de eventos (data-cobom-action) + escapeHtml global

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
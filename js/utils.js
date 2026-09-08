// js/utils.js - Utilitários gerais (normalização, municípios, toast, tiles)

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
 * Ex.: "Belo Horizonte - Logradouros" → "Belo Horizonte"
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
 * Extrai/constrói informações estruturadas do logradouro a partir das propriedades
 * e, se necessário, do nome da camada (fallback para arquivos agregados).
 *
 * @param {object} props - properties da feature
 * @param {string} [layerName] - nome da camada (ex.: "Belo Horizonte - Logradouros")
 */
function getFeatureStreetInfo(props, layerName = '') {
    if (!props) return null;

    let fullName = '';
    let streetOnly = '';
    let tipLog = props.NM_TIP_LOG || '';
    let titLog = props.NM_TIT_LOG || '';

    // 1º tenta pelo código IBGE (quando existir)
    let munName = getMunicipalityName(props.CD_SETOR || props.CD_MUN);

    // 2º fallback: nome da camada
    if (!munName && layerName) {
        munName = getMunicipalityFromLayerName(layerName);
    }

    // Formato padrão Censo IBGE / arquivos simplificados
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

/**
 * Extrai o nome textual simples do logradouro
 */
function getFeatureStreetName(props, layerName = '') {
    const info = getFeatureStreetInfo(props, layerName);
    return info ? info.fullName : '';
}

/**
 * Função utilitária de notificações Toast (não bloqueantes)
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
        indicator.textContent = 'Online';
        indicator.className = 'status-indicator online';
    } else {
        indicator.textContent = 'Offline';
        indicator.className = 'status-indicator offline';
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

// ---------------------------------------------------------------------------
// Parse de endereço com número + interpolação aproximada em faces de logradouro
// ---------------------------------------------------------------------------

/**
 * Extrai a parte do logradouro e o número (se existir) de uma query.
 * Exemplos:
 *   "Rua das Flores 123"     → { streetPart: "rua das flores", number: 123, hasNumber: true }
 *   "Av. Afonso Pena, 1500"  → { streetPart: "avenida afonso pena", number: 1500, hasNumber: true }
 *   "Rua das Flores"         → { streetPart: "rua das flores", number: null, hasNumber: false }
 */
function parseAddressQuery(query) {
    if (!query) return { streetPart: '', number: null, hasNumber: false };

    let q = String(query).trim();

    // Remove pontuação comum de endereço, mantém espaços
    q = q.replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();

    // Padrões de número: "123", "nº 123", "n. 123", "num 123", "n 123"
    const numberRegex = /(?:n[ºo°.]?\s*|num\.?\s*|n\s+)?(\d{1,5})\s*$/i;
    const match = q.match(numberRegex);

    let number = null;
    let streetPart = q;

    if (match) {
        number = parseInt(match[1], 10);
        streetPart = q.slice(0, match.index).trim();
        // Remove possíveis "nº", "n.", etc. que ficaram no final do streetPart
        streetPart = streetPart.replace(/(?:n[ºo°.]?\s*|num\.?\s*|n\s+)$/i, '').trim();
    }

    // Normaliza o nome do logradouro (usa a função já existente)
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
 * com base no número do endereço e no total de residências (TOT_RES).
 *
 * @param {Array} features - features GeoJSON da mesma rua (LineString/MultiLineString)
 * @param {number} number - número do endereço solicitado
 * @param {number} totalRes - soma de TOT_RES dos segmentos (ou estimativa)
 * @returns {{lat: number, lng: number}|null}
 */
function interpolatePointOnStreet(features, number, totalRes) {
    if (!features || features.length === 0 || !number || number < 1) return null;
    if (typeof turf === 'undefined') return null;

    // Estimativa de "capacidade" da rua
    // Usamos TOT_RES * 2 (lado par/ímpar) ou, na falta, um valor conservador
    const estimatedCapacity = Math.max(
        (totalRes > 0 ? totalRes * 2 : 0),
        features.length * 8,          // fallback mínimo por segmento
        20
    );

    // Se o número estiver muito acima da capacidade estimada → recusar
    if (number > estimatedCapacity * 1.4) {
        return null; // sinaliza "fora da faixa"
    }

    // Coleta todos os segmentos com comprimento e peso
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

    // Posição normalizada 0–1 (com leve bias para o início da rua)
    // Usamos o número relativo à capacidade estimada
    const ratio = Math.min(1, Math.max(0, (number - 1) / Math.max(estimatedCapacity - 1, 1)));

    // Percorre os segmentos acumulando peso (ou comprimento)
    let accumulated = 0;
    const target = ratio * (totalWeight > 0 ? totalWeight : totalLength);

    for (const seg of segments) {
        const segWeight = totalWeight > 0 ? seg.weight : seg.length;
        if (accumulated + segWeight >= target) {
            // Ponto dentro deste segmento
            const localRatio = segWeight > 0
                ? (target - accumulated) / segWeight
                : 0.5;

            try {
                const along = turf.along(seg.feature, localRatio * seg.length, { units: 'meters' });
                const [lng, lat] = along.geometry.coordinates;
                return { lat, lng };
            } catch (e) {
                // fallback para o ponto médio do segmento
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

    // Último segmento (por segurança)
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
 * daquela rua a partir das camadas já carregadas no IndexedDB.
 */
async function getStreetFeaturesByKey(streetKeyOrName, munName = '') {
    const layers = await DB.getLayers();
    const result = [];
    const targetNorm = normalizeStr(streetKeyOrName);
    const munNorm = normalizeStr(munName);

    for (const layer of layers) {
        if (!layer?.geojson?.features) continue;
        // Só camadas de logradouro
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

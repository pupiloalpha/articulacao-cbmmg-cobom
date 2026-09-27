// js/layers.js - Carregamento, renderização e controle de visualização de camadas GeoJSON
// Inclui carregamento PROGRESSIVO de logradouros (núcleo RMBH + sob demanda)

// ===========================================================================
// ÍCONES SVG DE UI
// ---------------------------------------------------------------------------
// Substituem emojis ZWJ (ex.: 👁️‍🗨️) que falham em renderizadores mobile,
// exibindo "olho + balão de diálogo" em vez do ícone único. SVGs inline
// garantem renderização idêntica em todos os browsers (Feather Icons).
// ===========================================================================
const UI_ICONS = {
    eyeOpen: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    eyeClosed: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
    edit:     `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    copy:     `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    up:       `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`,
    down:     `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    trash:    `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`
};

// ===========================================================================
// CATEGORIZAÇÃO DE CAMADAS
// ---------------------------------------------------------------------------
// Cada camada recebe uma "categoria dominante" (amostragem de até 30 feições).
// Alimenta os chips flutuantes de filtro.
// ===========================================================================
const _layerCategoryCache = new Map();

function invalidateLayerCategoryCache() {
    _layerCategoryCache.clear();
}

function getLayerCategory(layer) {
    if (!layer?.id) return 'OTHER';
    if (_layerCategoryCache.has(layer.id)) return _layerCategoryCache.get(layer.id);

    const features = layer?.geojson?.features;
    if (!Array.isArray(features) || features.length === 0) {
        _layerCategoryCache.set(layer.id, 'OTHER');
        return 'OTHER';
    }

    const counts = {};
    const sample = Math.min(features.length, 30);
    for (let i = 0; i < sample; i++) {
        const f = features[i];
        if (!f?.geometry) continue;
        const cat = typeof getFeatureClassification === 'function'
            ? getFeatureClassification(f)
            : 'OTHER';
        counts[cat] = (counts[cat] || 0) + 1;
    }

    const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'OTHER';
    _layerCategoryCache.set(layer.id, winner);
    return winner;
}

// Metadados visuais por categoria (rótulo, emoji, cor institucional)
const LAYER_CATEGORY_META = {
    UNIDADE_BM:   { label: 'Unidades BM',  icon: '🚒', color: '#c0392b' },
    HOSPITAL:     { label: 'Hospitais',    icon: '🏥', color: '#2980b9' },
    HIDRANTE:     { label: 'Hidrantes',    icon: '🚰', color: '#1f618d' },
    EVENTO_FOGO:  { label: 'Fogo',         icon: '🔥', color: '#e67e22' },
    CHAMADA:      { label: 'Chamadas',     icon: '🚨', color: '#e74c3c' },
    POLYGON:      { label: 'Articulação',  icon: '🛡️', color: '#0288d1' },
    MACRORREGIAO: { label: 'Macro',        icon: '🗺️', color: '#8e44ad' },
    MICRORREGIAO: { label: 'Micro',        icon: '🗺️', color: '#27ae60' },
    OTHER:        { label: 'Outras',       icon: '📍', color: '#6b7280' }
};

const LAYER_CATEGORY_ORDER = [
    'UNIDADE_BM', 'HOSPITAL', 'HIDRANTE', 'EVENTO_FOGO',
    'CHAMADA', 'POLYGON', 'MACRORREGIAO', 'MICRORREGIAO', 'OTHER'
];

// ---------------------------------------------------------------------------
// Semeia dados iniciais (Unidades BM + Articulação)
// ---------------------------------------------------------------------------
async function seedInitialData() {
    const layers = await DB.getLayers();
    if (layers.length > 0) return;

    try {
        const response = await fetch('./data/backup_inicial.json');
        if (!response.ok) {
            console.warn('backup_inicial.json não encontrado ou inacessível.');
            return;
        }
        const backup = await response.json();

        const features =
            backup.featureCollection?.features ||
            backup.features ||
            [];

        if (!features.length) {
            console.warn('backup_inicial.json sem feições.');
            return;
        }

        const grouped = {};
        features.forEach(feature => {
            const layerName =
                feature.properties?._layerName ||
                (feature.geometry?.type === 'Point' ? 'Unidades BM' : 'Articulação BM');

            if (!grouped[layerName]) {
                grouped[layerName] = { type: 'FeatureCollection', features: [] };
            }

            const clean = JSON.parse(JSON.stringify(feature));
            if (clean.properties) {
                delete clean.properties._layerId;
                delete clean.properties._layerName;
            }
            grouped[layerName].features.push(clean);
        });

        const preferredOrder = {
            'Articulação BM': 10,
            'Articulação CBMMG': 10,
            'Unidades BM': 100,
            'Unidades CBMMG': 100
        };

        for (const [name, geojson] of Object.entries(grouped)) {
            if (['RMBH', 'Ruas', 'Logradouros', 'Street'].some(k => name.includes(k))) continue;

            await DB.saveLayer({
                name,
                type: 'geojson',
                order: preferredOrder[name] ?? 50,
                geojson
            });
            console.log(`Camada inicial importada: ${name} (${geojson.features.length} feições)`);
        }
    } catch (e) {
        console.warn('Erro ao carregar dados iniciais de backup:', e);
    }
}

async function loadGeoOrTopo(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Falha ao carregar ${url}`);
    const data = await res.json();

    if (data.type === 'Topology') {
        if (typeof topojson === 'undefined' || !topojson.feature) {
            throw new Error('topojson-client não carregado');
        }
        const objectName = Object.keys(data.objects)[0];
        const geojson = topojson.feature(data, data.objects[objectName]);
        if (geojson.type === 'Feature') {
            return { type: 'FeatureCollection', features: [geojson] };
        }
        return geojson;
    }
    return data;
}

async function loadMicroMacroRegions() {
    try {
        const existing = await DB.getLayers();
        const hasMicro = existing.some(l => l.name && l.name.includes('Microrregi'));
        const hasMacro = existing.some(l => l.name && l.name.includes('Macrorregi'));

        if (!hasMacro) {
            try {
                const geojson = await loadGeoOrTopo('./data/macrorregioes/macrorregioes.topojson');
                if (geojson) {
                    await DB.saveLayer({
                        name: 'Macrorregiões de Saúde',
                        type: 'geojson',
                        order: 20,
                        geojson
                    });
                    console.log('Camada Macrorregiões de Saúde importada.');
                }
            } catch (e) {
                console.warn('TopoJSON de Macrorregiões não encontrado.', e);
            }
        }

        if (!hasMicro) {
            try {
                const geojson = await loadGeoOrTopo('./data/microrregioes/microrregioes.topojson');
                if (geojson) {
                    await DB.saveLayer({
                        name: 'Microrregiões de Saúde',
                        type: 'geojson',
                        order: 30,
                        geojson
                    });
                    console.log('Camada Microrregiões de Saúde importada.');
                }
            } catch (e) {
                console.warn('TopoJSON de Microrregiões não encontrado.', e);
            }
        }
    } catch (e) {
        console.warn('Erro ao carregar Micro/Macro regiões:', e);
    }
}

async function loadHospitalsData() {
    try {
        const existing = await DB.getLayers();
        const hasHospitals = existing.some(l =>
            l.name && (l.name.includes('Hospital') || l.name.includes('Hospitais'))
        );
        if (hasHospitals) {
            console.log('Dados de hospitais já carregados.');
            return;
        }

        const res = await fetch('./data/hospitais/hospitais_referencia_mg.geojson');
        if (!res.ok) throw new Error('Arquivo de hospitais não encontrado');
        const geojson = await res.json();

        await DB.saveLayer({
            name: 'Hospitais de Referência MG',
            type: 'geojson',
            geojson
        });
        console.log('Camada Hospitais de Referência MG importada.');
    } catch (e) {
        console.error('Erro ao carregar hospitais:', e);
    }
}

async function loadHidrantesData() {
    try {
        const existing = await DB.getLayers();
        if (existing.some(l => l.name && l.name.toLowerCase().includes('hidrante'))) {
            console.log('Dados de hidrantes já carregados.');
            return;
        }
        const res = await fetch('./data/hidrantes/hidrantes.geojson');
        if (!res.ok) throw new Error('Arquivo de hidrantes não encontrado');
        const geojson = await res.json();

        if (Array.isArray(geojson.features)) {
            geojson.features.forEach(f => {
                if (!f.properties) f.properties = {};
                f.properties._tipo = 'HIDRANTE';
            });
        }

        await DB.saveLayer({
            name: 'Hidrantes',
            type: 'geojson',
            order: 35,
            geojson
        });
        console.log(`Camada Hidrantes importada (${geojson.features?.length || 0} feições).`);
    } catch (e) {
        console.warn('Erro ao carregar hidrantes:', e);
    }
}


// ===========================================================================
// CARREGAMENTO PROGRESSIVO DE LOGRADOUROS
// ===========================================================================

const RMBH_CORE_CODES = [
    '3106200', '3118601', '3106705', '3156700', '3157807',
    '3171204', '3129806', '3154606', '3144805', '3109006'
];

const loadedStreetMunicipalities = new Set();

async function fetchStreetsIndex() {
    let files = null;
    let base = './';

    try {
        const res = await fetch(base + 'data/ruas/index.json');
        if (res.ok) files = await res.json();
    } catch (e) {
        console.warn('Índice local de ruas não encontrado, tentando remoto...', e);
    }

    if (!files) {
        const baseUrl = 'https://raw.githubusercontent.com/pupiloalpha/articulacao-cbmmg-cobom/refs/heads/main/';
        const res = await fetch(baseUrl + 'data/ruas/index.json');
        if (!res.ok) throw new Error('Falha ao baixar índice de ruas.');
        files = await res.json();
        base = baseUrl;
    }

    return { files, base };
}

async function hasAnyStreetLayer() {
    const layers = await DB.getLayers();
    return layers.some(l =>
        l.name && (l.name.includes('Logradouros') || l.name.includes('Ruas') || l.name.includes('Street'))
    );
}

async function getAlreadyLoadedStreetNames() {
    const layers = await DB.getLayers();
    const names = new Set();
    layers.forEach(l => {
        if (l.name && (l.name.includes('Logradouros') || l.name.includes('Ruas'))) {
            const mun = typeof getMunicipalityFromLayerName === 'function'
                ? getMunicipalityFromLayerName(l.name)
                : l.name;
            if (mun) {
                const n = normalizeStr(mun);
                names.add(n);
                loadedStreetMunicipalities.add(n);
            }
        }
    });
    return names;
}

async function loadSingleStreetFile(fileInfo, base) {
    const targetUrl = fileInfo.url.startsWith('http')
        ? fileInfo.url
        : (base + fileInfo.url);

    const res = await fetch(targetUrl);
    if (!res.ok) {
        console.warn(`Falha ao carregar ${fileInfo.url}`);
        return false;
    }

    const geojson = await res.json();

    const existing = await DB.getLayers();
    if (existing.some(l => l.name === fileInfo.name)) {
        const munNorm = normalizeStr(
            typeof getMunicipalityFromLayerName === 'function'
                ? getMunicipalityFromLayerName(fileInfo.name)
                : fileInfo.name
        );
        loadedStreetMunicipalities.add(munNorm);
        return true;
    }

    await DB.saveLayer({
        name: fileInfo.name,
        type: 'geojson',
        geojson
    });

    const munNorm = normalizeStr(
        typeof getMunicipalityFromLayerName === 'function'
            ? getMunicipalityFromLayerName(fileInfo.name)
            : fileInfo.name
    );
    loadedStreetMunicipalities.add(munNorm);
    console.log(`Logradouros carregados: ${fileInfo.name}`);
    return true;
}

async function loadRMBHCoreStreets() {
    const already = await getAlreadyLoadedStreetNames();
    if (already.size >= Math.min(5, RMBH_CORE_CODES.length)) {
        console.log('Núcleo RMBH de logradouros já presente.');
        return;
    }

    const { files, base } = await fetchStreetsIndex();
    const toLoad = files.filter(f => {
        const code = (f.url || '').split('/').pop().slice(0, 7);
        return RMBH_CORE_CODES.includes(code);
    });

    console.log(`Carregando núcleo RMBH (${toLoad.length} municípios)...`);
    for (const fileInfo of toLoad) {
        await loadSingleStreetFile(fileInfo, base);
    }
}

async function ensureStreetDataForMunicipality(munName) {
    if (!munName) return false;

    const norm = normalizeStr(munName);
    if (loadedStreetMunicipalities.has(norm)) return true;

    const already = await getAlreadyLoadedStreetNames();
    if (already.has(norm)) return true;

    const { files, base } = await fetchStreetsIndex();

    const match = files.find(f => {
        const nameNorm = normalizeStr(
            typeof getMunicipalityFromLayerName === 'function'
                ? getMunicipalityFromLayerName(f.name)
                : f.name
        );
        return nameNorm === norm || nameNorm.includes(norm) || norm.includes(nameNorm);
    });

    if (!match) {
        console.warn(`Município não encontrado no índice de logradouros: ${munName}`);
        return false;
    }

    return await loadSingleStreetFile(match, base);
}

async function ensureStreetDataForQuery(query) {
    await loadRMBHCoreStreets();

    if (!query || String(query).trim().length < 3) return;

    const expanded = typeof expandSearchQuery === 'function'
        ? expandSearchQuery(query)
        : normalizeStr(query);
    const tokens = expanded.split(/\s+/).filter(t => t.length >= 3);

    if (tokens.length === 0) return;

    const { files } = await fetchStreetsIndex();
    const possibleMuns = files.map(f =>
        typeof getMunicipalityFromLayerName === 'function'
            ? getMunicipalityFromLayerName(f.name)
            : f.name
    );

    for (const mun of possibleMuns) {
        const munNorm = normalizeStr(mun);
        if (munNorm.length < 4) continue;

        const match = tokens.some(t =>
            munNorm.includes(t) || t.includes(munNorm.split(' ')[0])
        );
        if (match) {
            await ensureStreetDataForMunicipality(mun);
        }
    }
}

async function loadStreetDataFromGitHub(query = '') {
    try {
        const hasAny = await hasAnyStreetLayer();
        if (!hasAny) {
            await loadRMBHCoreStreets();
        }

        if (query) {
            await ensureStreetDataForQuery(query);
        }

        if (typeof invalidateStreetIndex === 'function') {
            invalidateStreetIndex();
        }
    } catch (error) {
        console.error('Erro ao carregar dados das ruas (progressivo):', error);
    }
}

async function cleanupMunicipioFeatures() {
    try {
        const layers = await DB.getLayers();
        let changed = false;

        for (const layer of layers) {
            if (!layer.geojson?.features) continue;
            const originalLen = layer.geojson.features.length;
            layer.geojson.features = layer.geojson.features.filter(f =>
                getFeatureClassification(f) !== 'MUNICIPIO'
            );
            if (layer.geojson.features.length !== originalLen) {
                await DB.updateLayer(layer.id, { geojson: layer.geojson });
                changed = true;
            }
        }
        if (changed) {
            console.log('Feições MUNICIPIO removidas das camadas existentes.');
            await reloadLayers();
        }
    } catch (e) {
        console.warn('Erro na limpeza de MUNICIPIO:', e);
    }
}

async function reloadLayers() {
    Object.values(overlayLayers).forEach(layer => {
        if (map && map.hasLayer(layer)) map.removeLayer(layer);
    });
    overlayLayers = {};

    const layers = await DB.getLayers();
    const isOffline = !navigator.onLine;
    const streetKeywords = ['RMBH', 'Ruas', 'Logradouros', 'Street'];

    for (const layerData of layers) {
        const isStreetLayer = streetKeywords.some(keyword =>
            layerData.name && layerData.name.includes(keyword)
        );

        if (isStreetLayer && !isOffline) continue;

        if (layerVisibility[layerData.id] === undefined) {
            layerVisibility[layerData.id] = true;
        }
        if (layerVisibility[layerData.id]) {
            addLayerToMap(layerData, viewMode, isStreetLayer);
        }
    }

    if (typeof invalidateStreetIndex === 'function') {
        invalidateStreetIndex();
    }
    updateLayerListUI();

    if (typeof renderLegend === 'function') {
        renderLegend().catch(() => {});
    }
}

function getFeatureClassification(feature) {
    const geomType = feature.geometry?.type;
    const props = feature.properties || {};

if (geomType === 'Polygon' || geomType === 'MultiPolygon') {

        if (props._tipo === 'EVENTO_FOGO' ||
            (props.id_evento !== undefined && props.status_evento !== undefined)) {
            return 'EVENTO_FOGO';
        }

        // ⚠️ MICRORREGIAO é testada ANTES de MACRORREGIAO.
        // Motivo: features de microrregião TAMBÉM têm o campo
        // "Macrorregião de Saúde" (indicando a qual macro pertencem).
        // Se a checagem de macro viesse primeiro, ela daria falso
        // positivo para microrregiões.
        if (
            props['Regionalização pop. 2025 — RegionalizaçãoMG2025_Microrregião de Saúde'] ||
            props['Microrregião de Saúde'] ||
            props['Código Micro'] ||
            props['Regionalização pop. 2025 — RegionalizaçãoMG2025_Código Micro'] ||
            (props.NM_RGI && props['Regionalização pop. 2025 — RegionalizaçãoMG2025_Código Micro'])
        ) {
            return 'MICRORREGIAO';
        }

        if (
            props.Hospitais_de_Referencia_Macrorregiao ||
            props.Hospitais_de_Referencia_Macrorregiao_Texto ||
            props.Macrorregiao_Saude ||
            props.Central_SAMU_192 ||
            (props['Regionalização pop. 2025 — RegionalizaçãoMG2025_Macrorregião de Saúde'] &&
             !props['Regionalização pop. 2025 — RegionalizaçãoMG2025_Microrregião de Saúde'])
        ) {
            return 'MACRORREGIAO';
        }

        return 'POLYGON';
    }

    if (geomType === 'Point') {

        // Detecta pelo marcador interno, propriedades típicas ou nome da camada
	if (
	    props._tipo === 'HIDRANTE' ||
	    props.numHidrante || props.codigo_hidrante || props.HIDRANTE ||
	    (props.tipo && /hidrante/i.test(String(props.tipo))) ||
	    (props.Tipo && /hidrante/i.test(String(props.Tipo)))
	) {
	    return 'HIDRANTE';
	}
        if (props._tipo === 'CHAMADA' || props.numChamada) {
            return 'CHAMADA';
        }
        if (
            props['Nome do Hospital'] ||
            props['Macrorregião de Saúde'] ||
            props.Tipo === 'UPA' ||
            (props.name && String(props.name).toLowerCase().includes('hospital')) ||
            (props.name && String(props.name).toLowerCase().startsWith('upa '))
        ) {
            return 'HOSPITAL';
        }

        if (
            props.UEOP ||
            props.COB ||
            props['FRAÇÃO'] ||
            props['BBM / CIA IND'] ||
            props['COB / CEB'] ||
            props['Nome da Unidade'] ||
            props.Fração
        ) {
            return 'UNIDADE_BM';
        }

        return 'UNIDADE_BM';
    }

    return 'OTHER';
}

function isUPA(feature) {
    const props = feature.properties || {};
    if (props.Tipo === 'UPA') return true;
    const nome = String(props['Nome do Hospital'] || props.name || '').toLowerCase();
    return nome.startsWith('upa ') || nome.includes('unidade de pronto atendimento');
}

function getFeatureDisplayName(feature) {
    const props = feature.properties || {};
    const type = getFeatureClassification(feature);

    if (type === 'HOSPITAL') {
        const nome = props['Nome do Hospital'] || props.name || 'Hospital';
        return isUPA(feature) ? `🚑 ${nome}` : nome;
    }
    if (type === 'UNIDADE_BM') {
        return props.name || props['Nome da Unidade'] || 'Unidade Operacional';
    }
    if (type === 'EVENTO_FOGO') {
        return `Evento #${props.id_evento ?? '-'}`;
    }
    if (type === 'CHAMADA') {
        return `Chamada ${props.numChamada || 's/n'}`;
    }
    return props.name || props['Nome do Hospital'] || 'Feição';
}

function getFeatureCoords(feature) {
    if (!feature.geometry) return null;
    if (feature.geometry.type === 'Point') {
        return { lng: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1] };
    }
    try {
        if (typeof turf !== 'undefined' && turf.center) {
            const c = turf.center(feature);
            return { lng: c.geometry.coordinates[0], lat: c.geometry.coordinates[1] };
        }
    } catch (e) {
        console.warn('Erro ao obter centroide da feição:', e);
    }
    return null;
}

function formatFeatureTooltip(feature) {
    const props = feature.properties || {};
    const type = getFeatureClassification(feature);
    const coords = getFeatureCoords(feature);

if (type === 'HIDRANTE') {
    const p = props;

    const coordsStr = coords
        ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
        : '-';

    // ---------- Identificação ----------
    // Aceita tanto o esquema CBMMG (id/nReds/logradouro/...)
    // quanto o esquema "clássico" (numHidrante/tipo/endereco/...).
    const hidranteId  = p.numHidrante || p.codigo || p.id || 's/n';
    const tipoLabel   = p.tipo || p.Tipo || 'Hidrante';

    // ---------- Endereço ----------
    const logradouro  = p.logradouro || p.Logradouro || '';
    const numero      = p.numero     || p.Numero     || '';
    const bairro      = p.bairro     || p.Bairro     || '';
    const cidade      = p.cidade || p.Cidade || p.municipio || p.Município || '';
    const referencia  = p.referencia || p.Referencia || '';

    const enderecoCompleto = p.endereco || p.Endereço ||
        [logradouro, numero].filter(Boolean).join(', ');

    // ---------- Vistoria / responsável ----------
    const dataRaw    = p.data || p.ultimaManutencao || p.data_vistoria || '';
    const nReds      = p.nReds || p.numREDS || p.REDS || '';
    const unidade    = p.unidade || p.Unidade || '';
    const responsavel = p.responsavel || p['Órgão responsável'] || '';

    // Normaliza DD-MM-AAAA → DD/MM/AAAA (mantém ISO intacto)
    let dataFmt = dataRaw;
    if (dataRaw && /^\d{2}-\d{2}-\d{4}$/.test(dataRaw)) {
        const [d, m, y] = dataRaw.split('-');
        dataFmt = `${d}/${m}/${y}`;
    }

    // ---------- Situação (badge) ----------
    const situacao = String(
        p.situacao || p.Situacao || p.status || p.Status || 'Ativo'
    ).trim();
    const sn = situacao.toLowerCase();
    let badgeCls = 'badge-tempo-verde';
    if (sn.includes('manut'))       badgeCls = 'badge-tempo-amarelo';
    else if (sn.includes('inativ')) badgeCls = 'badge-tempo-vermelho';

    return `
        <div class="feature-card-header" style="background: linear-gradient(135deg, #1f618d 0%, #2e86c1 100%);">
            <h4 class="feature-card-title">🚰 Hidrante ${hidranteId}</h4>
            <span class="feature-type-tag">${tipoLabel}</span>
        </div>
        <div class="feature-card-body">
            <div class="feature-info-grid">

                ${enderecoCompleto ? `
                <div class="feature-info-row" style="flex-direction:column;align-items:flex-start;">
                    <span class="feature-info-label">Endereço:</span>
                    <span class="feature-info-value" style="text-align:left;font-size:11.5px;font-weight:600;">
                        ${enderecoCompleto}${bairro ? ' — ' + bairro : ''}
                    </span>
                </div>` : (bairro ? `
                <div class="feature-info-row">
                    <span class="feature-info-label">Bairro:</span>
                    <span class="feature-info-value">${bairro}</span>
                </div>` : '')}

                ${cidade ? `
                <div class="feature-info-row">
                    <span class="feature-info-label">Município:</span>
                    <span class="feature-info-value">${cidade}</span>
                </div>` : ''}

                ${referencia ? `
                <div class="feature-info-row" style="flex-direction:column;align-items:flex-start;">
                    <span class="feature-info-label">Referência:</span>
                    <span class="feature-info-value" style="text-align:left;font-size:11px;line-height:1.35;">
                        ${referencia}
                    </span>
                </div>` : ''}

                <div class="feature-info-row">
                    <span class="feature-info-label">Situação:</span>
                    <span class="feature-info-value">
                        <span class="feature-badge ${badgeCls}">${situacao}</span>
                    </span>
                </div>

                ${dataFmt ? `
                <div class="feature-info-row">
                    <span class="feature-info-label">Última vistoria:</span>
                    <span class="feature-info-value" style="font-size:11px;">${dataFmt}</span>
                </div>` : ''}

                ${nReds ? `
                <div class="feature-info-row">
                    <span class="feature-info-label">REDS:</span>
                    <span class="feature-info-value" style="font-size:10.5px;font-family:monospace;">${nReds}</span>
                </div>` : ''}

                ${unidade ? `
                <div class="feature-info-row">
                    <span class="feature-info-label">Unidade BM:</span>
                    <span class="feature-info-value">${unidade}</span>
                </div>` : ''}

                ${p.diametro ? `
                <div class="feature-info-row">
                    <span class="feature-info-label">Diâmetro:</span>
                    <span class="feature-info-value">${p.diametro}</span>
                </div>` : ''}

                ${p.vazao ? `
                <div class="feature-info-row">
                    <span class="feature-info-label">Vazão:</span>
                    <span class="feature-info-value">${p.vazao}</span>
                </div>` : ''}

                ${responsavel ? `
                <div class="feature-info-row">
                    <span class="feature-info-label">Responsável:</span>
                    <span class="feature-info-value" style="font-size:11px;">${responsavel}</span>
                </div>` : ''}

                <div class="feature-info-row">
                    <span class="feature-info-label">Coordenadas:</span>
                    <span class="feature-info-value" style="font-size:11px;font-family:monospace;">${coordsStr}</span>
                </div>
            </div>
        </div>
    `;
}

    if (type === 'CHAMADA') {
        const st = (typeof getChamadaSituationStyle === 'function')
            ? getChamadaSituationStyle(props.situacao)
            : { color: '#e74c3c', border: '#922b21', label: props.situacao || '—' };

        const isSim = (v) => String(v || '').toLowerCase().trim().startsWith('s');

        const badges = [];
        if (isSim(props.alerta))            badges.push('<span class="feature-badge" style="background:#fadbd8;color:#922b21;">⚠️ Alerta</span>');
        if (isSim(props.destaque))          badges.push('<span class="feature-badge" style="background:#fdebd0;color:#b9770e;">⭐ Destaque</span>');
        if (isSim(props.envolveAutoridade)) badges.push('<span class="feature-badge" style="background:#e8daef;color:#6c3483;">👮 Autoridade</span>');

        const badgesHtml = badges.length
            ? `<div class="feature-info-row" style="flex-wrap:wrap;gap:4px;justify-content:flex-start;">${badges.join(' ')}</div>`
            : '';

        return `
            <div class="feature-card-header" style="background: linear-gradient(135deg, ${st.color} 0%, ${st.border} 100%);">
                <h4 class="feature-card-title">🚨 Chamada ${props.numChamada || 's/n'}</h4>
                <span class="feature-type-tag">${st.label}</span>
            </div>
            <div class="feature-card-body">
                <div class="feature-info-grid">
                    ${props.numREDS ? `
                    <div class="feature-info-row">
                        <span class="feature-info-label">REDS:</span>
                        <span class="feature-info-value" style="font-family:monospace;font-size:10.5px;">${props.numREDS}</span>
                    </div>` : ''}
                    <div class="feature-info-row" style="flex-direction:column;align-items:flex-start;">
                        <span class="feature-info-label">Natureza:</span>
                        <span class="feature-info-value" style="text-align:left;font-size:11.5px;font-weight:600;line-height:1.35;">${props.natureza || '—'}</span>
                    </div>
                    <div class="feature-info-row" style="flex-direction:column;align-items:flex-start;">
                        <span class="feature-info-label">Local:</span>
                        <span class="feature-info-value" style="text-align:left;font-size:11px;">${props.localFato || '—'}</span>
                    </div>
                    ${props.unidadeResponsavel ? `
                    <div class="feature-info-row">
                        <span class="feature-info-label">Unidade:</span>
                        <span class="feature-info-value" style="font-size:11px;">${props.unidadeResponsavel}</span>
                    </div>` : ''}
                    ${props.recursosEmpenhados ? `
                    <div class="feature-info-row" style="flex-direction:column;align-items:flex-start;">
                        <span class="feature-info-label">Recursos empenhados:</span>
                        <span class="feature-info-value" style="text-align:left;font-size:10.5px;font-family:monospace;">${props.recursosEmpenhados}</span>
                    </div>` : ''}
                    <div class="feature-info-row">
                        <span class="feature-info-label">Criada em:</span>
                        <span class="feature-info-value" style="font-size:11px;">${props.dataCriacaoTexto || '—'}</span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Situação em:</span>
                        <span class="feature-info-value" style="font-size:11px;">${props.dataSituacaoAtualTexto || '—'}</span>
                    </div>
                    ${badgesHtml}
                </div>
            </div>`;
    }

    if (type === 'EVENTO_FOGO') {
    const fmtDate = (d) => d ? new Date(d).toLocaleString('pt-BR') : '-';
    const num = (v, dec = 2) =>
        (v == null || isNaN(v)) ? '-' :
        Number(v).toLocaleString('pt-BR', {
            minimumFractionDigits: dec,
            maximumFractionDigits: dec
        });

    const status  = props.status_evento || 'Evento';
    const area    = num(props.area_total_evento, 2);
    const persist = props.persistencia_dias ?? '-';
    const dtMin   = fmtDate(props.dt_minima);
    const dtMax   = fmtDate(props.dt_maxima);
    const dtVisto = fmtDate(props.dt_ultima_visao);
    const mun     = props.municipio || '-';
    const pais    = props.pais || 'Brasil';
    const dominio = props.dominio || '-';
    const ti      = props.terra_indigena || '-';
    const uc      = props.unidade_conservacao || '-';
    const quil    = props.quilombola || '-';
    const pa      = props.projeto_assentamento || '-';

    // ---------- Coordenadas (pedido 2) ----------
    // Prioriza latitude/longitude enviadas pela API (mais fiéis ao evento);
    // fallback no centroide geométrico (turf.center).
    const evLat = (props.latitude  != null && props.latitude  !== '') ? Number(props.latitude)  : (coords ? coords.lat : null);
    const evLng = (props.longitude != null && props.longitude !== '') ? Number(props.longitude) : (coords ? coords.lng : null);
    const hasCoords = Number.isFinite(evLat) && Number.isFinite(evLng);
    const coordsStr = hasCoords ? `${evLat.toFixed(5)}, ${evLng.toFixed(5)}` : '-';
    const copyBtn = hasCoords
        ? `<button type="button" class="btn-copy-coords-inline"
                   title="Copiar coordenadas do evento"
                   aria-label="Copiar coordenadas"
                   onclick="event.stopPropagation(); event.preventDefault(); window.copyFeatureCoords(${evLat}, ${evLng});">📋</button>`
        : '';

    // ---------- Índice de prioridade ----------
    const indice      = props.indice_prioridade  != null ? Number(props.indice_prioridade)  : null;
    const variacao    = props.indice_variacao    != null ? Number(props.indice_variacao)    : null;
    const indiceRef   = props.indice_referencia  != null ? Number(props.indice_referencia)  : null;
    const dtIndiceMax = props.indice_dt_maxima ? fmtDate(props.indice_dt_maxima) : null;

    const isAtivo = String(status).toLowerCase().includes('ativo');
    const headerClass = isAtivo ? 'header-unidade' : 'header-micro';
    const icon = isAtivo ? '🚨' : '👀';

    let prioridadeBadge = '<span class="feature-badge badge-tempo-neutro">sem índice</span>';
    if (indice != null && Number.isFinite(indice)) {
        const cls = indice >= 0.7 ? 'badge-cob'
                  : indice >= 0.4 ? 'badge-zona'
                  : 'badge-tempo-verde';
        const seta = variacao > 0 ? '▲' : (variacao < 0 ? '▼' : '■');
        const varTxt = (variacao != null && Number.isFinite(variacao))
            ? ` <small>(${variacao >= 0 ? '+' : ''}${variacao.toFixed(2)})</small>`
            : '';
        prioridadeBadge = `<span class="feature-badge ${cls}">${seta} ${indice.toFixed(2)}${varTxt}</span>`;
    }

    const refInfo = (indiceRef != null && Number.isFinite(indiceRef))
        ? `<div class="feature-info-row">
               <span class="feature-info-label">Índice anterior:</span>
               <span class="feature-info-value" style="font-size:11px;">
                   ${indiceRef.toFixed(2)}${dtIndiceMax ? ' • ' + dtIndiceMax : ''}
               </span>
           </div>`
        : '';

    return `
        <div class="feature-card-header ${headerClass}">
            <h4 class="feature-card-title">${icon} Evento #${props.id_evento ?? '-'}</h4>
            <span class="feature-type-tag">${status}</span>
        </div>
        <div class="feature-card-body">
            <div class="feature-info-grid">
                <div class="feature-info-row">
                    <span class="feature-info-label">Prioridade:</span>
                    <span class="feature-info-value">${prioridadeBadge}</span>
                </div>
                ${refInfo}
                <div class="feature-info-row">
                    <span class="feature-info-label">Área total:</span>
                    <span class="feature-info-value"><b>${area} km²</b></span>
                </div>
                <div class="feature-info-row">
                    <span class="feature-info-label">Persistência:</span>
                    <span class="feature-info-value">${persist} dias</span>
                </div>
                <div class="feature-info-row">
                    <span class="feature-info-label">1ª detecção:</span>
                    <span class="feature-info-value" style="font-size:11px;">${dtMin}</span>
                </div>
                <div class="feature-info-row">
                    <span class="feature-info-label">Última detecção:</span>
                    <span class="feature-info-value" style="font-size:11px;">${dtMax}</span>
                </div>
                <div class="feature-info-row">
                    <span class="feature-info-label">Última visão:</span>
                    <span class="feature-info-value" style="font-size:11px;">${dtVisto}</span>
                </div>
                <div class="feature-info-row">
                    <span class="feature-info-label">Município:</span>
                    <span class="feature-info-value">${mun}</span>
                </div>
                <div class="feature-info-row">
                    <span class="feature-info-label">Domínio:</span>
                    <span class="feature-info-value">${dominio} • ${pais}</span>
                </div>
                <div class="feature-info-row">
                    <span class="feature-info-label">Terra Indígena:</span>
                    <span class="feature-info-value" style="font-size:11px;">${ti}</span>
                </div>
                <div class="feature-info-row">
                    <span class="feature-info-label">Unid. Conservação:</span>
                    <span class="feature-info-value" style="font-size:11px;">${uc}</span>
                </div>
                <div class="feature-info-row">
                    <span class="feature-info-label">Quilombola:</span>
                    <span class="feature-info-value" style="font-size:11px;">${quil}</span>
                </div>
                <div class="feature-info-row">
                    <span class="feature-info-label">Assentamento:</span>
                    <span class="feature-info-value" style="font-size:11px;">${pa}</span>
                </div>
                <div class="feature-info-row">
                    <span class="feature-info-label">Coordenadas:</span>
                    <span class="feature-info-value"
                          style="font-size:11px;font-family:monospace;display:inline-flex;align-items:center;gap:4px;">
                        ${coordsStr}
                        ${copyBtn}
                    </span>
                </div>
            </div>
        </div>`;
}

    if (type === 'HOSPITAL') {
        const isUpa = isUPA(feature);
        const nome = props['Nome do Hospital'] || props.name || (isUpa ? 'UPA' : 'Hospital');
        const mun = props.Município || props.Municipio || '-';
        const macro = props['Macrorregião de Saúde'] || props.Macrorregiao_Saude || '-';
        const especialidades = props.Especialidades || props.especialidades || '';
        const endereco = props.Endereço || props.endereco || props.Endereco || '';
        const coordsStr = coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : '-';

        const headerClass = isUpa ? 'header-upa' : 'header-hospital';
        const typeTag = isUpa ? 'UPA – Pronto Atendimento' : 'Hospital de Referência';
        const icon = isUpa ? '🚑' : '🏥';

        let especialidadesHtml = '';
        if (especialidades) {
            const texto = String(especialidades).length > 220
                ? String(especialidades).slice(0, 217) + '…'
                : especialidades;
            especialidadesHtml = `
                <div class="feature-info-row" style="flex-direction:column;align-items:flex-start;">
                    <span class="feature-info-label">Especialidades:</span>
                    <span class="feature-info-value" style="text-align:left;font-size:11px;line-height:1.35;">
                        ${texto}
                    </span>
                </div>`;
        }

        let enderecoHtml = '';
        if (endereco) {
            enderecoHtml = `
                <div class="feature-info-row" style="flex-direction:column;align-items:flex-start;">
                    <span class="feature-info-label">Endereço:</span>
                    <span class="feature-info-value" style="text-align:left;font-size:11px;">${endereco}</span>
                </div>`;
        }

        return `
            <div class="feature-card-header ${headerClass}">
                <h4 class="feature-card-title">${icon} ${nome}</h4>
                <span class="feature-type-tag">${typeTag}</span>
            </div>
            <div class="feature-card-body">
                <div class="feature-info-grid">
                    <div class="feature-info-row">
                        <span class="feature-info-label">Município:</span>
                        <span class="feature-info-value">${mun}</span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Macrorregião:</span>
                        <span class="feature-info-value">
                            <span class="feature-badge ${isUpa ? 'badge-upa' : 'badge-macro'}">${macro}</span>
                        </span>
                    </div>
                    ${especialidadesHtml}
                    ${enderecoHtml}
                    <div class="feature-info-row">
                        <span class="feature-info-label">Coordenadas:</span>
                        <span class="feature-info-value" style="font-size:11px;font-family:monospace;">${coordsStr}</span>
                    </div>
                </div>
            </div>
        `;
    }

    if (type === 'MICRORREGIAO') {
        const microName =
            props['Regionalização pop. 2025 — RegionalizaçãoMG2025_Microrregião de Saúde'] ||
            props['Microrregião de Saúde'] ||
            props.NM_RGI ||
            props.name ||
            'Microrregião';

        const macroName =
            props['Regionalização pop. 2025 — RegionalizaçãoMG2025_Macrorregião de Saúde'] ||
            props['Macrorregião de Saúde'] ||
            props.Macrorregiao_Saude ||
            '-';

        const municipioSede =
            props['Município Sede'] ||
            props.NM_MUN ||
            props['Regionalização pop. 2025 — RegionalizaçãoMG2025_Município '] ||
            '-';

        const nmRgi = props.NM_RGI || '';
        const pop2022 = props['Regionalização pop. 2025 — RegionalizaçãoMG2025_POPULAÇÃO CENSO DEMOGRÁFICO (IBGE/2022)'];
        const pop2025 = props['Regionalização pop. 2025 — RegionalizaçãoMG2025_POPULAÇÃO CENSO DEMOGRÁFICO (IBGE/2025)'];
        const area = props.AREA_KM2
            ? `${Number(props.AREA_KM2).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km²`
            : '-';

        let hospList = props['Hospitais de Referência'] || props.Hospitais_de_Referencia || [];
        if ((!Array.isArray(hospList) || hospList.length === 0) && typeof props['Hospitais de Referência'] === 'string') {
            hospList = props['Hospitais de Referência'].split(/\n|\|/).map(h => h.trim()).filter(Boolean);
        }

        let hospitaisHtml = '<span style="color:#7f8c8d;">Não informado</span>';
        if (Array.isArray(hospList) && hospList.length > 0) {
            hospitaisHtml = hospList
                .map(h => `<div style="margin:2px 0;font-size:11px;line-height:1.3;">• ${h}</div>`)
                .join('');
        }

        return `
            <div class="feature-card-header header-micro">
                <h4 class="feature-card-title">🟢 ${microName}</h4>
                <span class="feature-type-tag">Microrregião de Saúde</span>
            </div>
            <div class="feature-card-body">
                <div class="feature-info-grid">
                    <div class="feature-info-row">
                        <span class="feature-info-label">Macrorregião:</span>
                        <span class="feature-info-value"><span class="feature-badge badge-macro">${macroName}</span></span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Município Sede:</span>
                        <span class="feature-info-value">${municipioSede}</span>
                    </div>
                    ${nmRgi ? `
                    <div class="feature-info-row">
                        <span class="feature-info-label">Região Imediata:</span>
                        <span class="feature-info-value" style="font-size:11px;">${nmRgi}</span>
                    </div>` : ''}
                    <div class="feature-info-row">
                        <span class="feature-info-label">Área:</span>
                        <span class="feature-info-value">${area}</span>
                    </div>
                    ${pop2022 ? `
                    <div class="feature-info-row">
                        <span class="feature-info-label">Pop. 2022:</span>
                        <span class="feature-info-value">${Number(pop2022).toLocaleString('pt-BR')}</span>
                    </div>` : ''}
                    ${pop2025 ? `
                    <div class="feature-info-row">
                        <span class="feature-info-label">Pop. 2025 (est.):</span>
                        <span class="feature-info-value">${Number(pop2025).toLocaleString('pt-BR')}</span>
                    </div>` : ''}
                    <div class="feature-info-row" style="flex-direction:column;align-items:flex-start;">
                        <span class="feature-info-label">Hospitais de Referência:</span>
                        <div style="margin-top:4px;max-height:140px;overflow-y:auto;width:100%;">${hospitaisHtml}</div>
                    </div>
                </div>
            </div>
        `;
    }

    if (type === 'MACRORREGIAO') {
        const macroName =
            props.Macrorregiao_Saude ||
            props['Regionalização pop. 2025 — RegionalizaçãoMG2025_Macrorregião de Saúde'] ||
            props['Macrorregião de Saúde'] ||
            props.name ||
            'Macrorregião';

        const municipioSede =
            props['Município Sede / Polo Macrorregional'] ||
            props['Município Sede'] ||
            '-';

        const centralSamu = props.Central_SAMU_192 || '';
        const municipioCentral = props.Municipio_Sede_Central_192 || '';
        const municipiosAtendidos = props.Municipios_Atendidos_Central_192 || '';

        let hospList = props.Hospitais_de_Referencia_Macrorregiao ||
                       props['Hospitais de Referência'] ||
                       props.Hospitais_de_Referencia ||
                       [];

        if ((!Array.isArray(hospList) || hospList.length === 0) && props.Hospitais_de_Referencia_Macrorregiao_Texto) {
            hospList = props.Hospitais_de_Referencia_Macrorregiao_Texto
                .split('|')
                .map(h => h.trim())
                .filter(Boolean);
        }

        let hospitaisHtml = '<span style="color:#7f8c8d;">Não informado</span>';
        if (Array.isArray(hospList) && hospList.length > 0) {
            hospitaisHtml = hospList
                .map(h => `<div style="margin:2px 0;font-size:11px;line-height:1.3;">• ${h}</div>`)
                .join('');
        } else if (typeof hospList === 'string' && hospList.trim()) {
            hospitaisHtml = `<div style="font-size:11px;">${hospList}</div>`;
        }

        return `
            <div class="feature-card-header header-macro">
                <h4 class="feature-card-title">🏥 ${macroName}</h4>
                <span class="feature-type-tag">Macrorregião de Saúde</span>
            </div>
            <div class="feature-card-body">
                <div class="feature-info-grid">
                    <div class="feature-info-row">
                        <span class="feature-info-label">Município Sede:</span>
                        <span class="feature-info-value">${municipioSede}</span>
                    </div>
                    ${centralSamu ? `
                    <div class="feature-info-row" style="flex-direction:column;align-items:flex-start;">
                        <span class="feature-info-label">Central SAMU 192:</span>
                        <span class="feature-info-value" style="text-align:left;font-weight:600;color:#1a5276;">
                            📞 ${centralSamu}${municipioCentral ? ' — ' + municipioCentral : ''}
                        </span>
                    </div>` : ''}
                    ${municipiosAtendidos ? `
                    <div class="feature-info-row" style="flex-direction:column;align-items:flex-start;">
                        <span class="feature-info-label">Municípios Atendidos pela Central 192:</span>
                        <div style="margin-top:4px;max-height:120px;overflow-y:auto;width:100%;font-size:11px;line-height:1.35;">
                            ${municipiosAtendidos}
                        </div>
                    </div>` : ''}
                    <div class="feature-info-row" style="flex-direction:column;align-items:flex-start;">
                        <span class="feature-info-label">Hospitais de Referência da Macro:</span>
                        <div style="margin-top:4px;max-height:130px;overflow-y:auto;width:100%;">
                            ${hospitaisHtml}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    if (type === 'UNIDADE_BM') {
        const unitName = props.name || props['Nome da Unidade'] || 'Unidade Operacional';
        const ueop = props.UEOP || props['BBM / CIA IND'] || '-';
        const cob = props.COB || props['COB / CEB'] || '-';
        const fracao = props['FRAÇÃO'] || props.Fração || props['Fração'] || '-';
        const municipio = props.Município || props.Municipio || '';
        const endereco = props.Endereço || props.endereco || props.Endereco || '';
        const coordsStr = coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : '-';

        return `
            <div class="feature-card-header header-unidade">
                <h4 class="feature-card-title">🚒 ${unitName}</h4>
                <span class="feature-type-tag">Fração BM</span>
            </div>
            <div class="feature-card-body">
                <div class="feature-info-grid">
                    ${municipio ? `
                    <div class="feature-info-row">
                        <span class="feature-info-label">Município:</span>
                        <span class="feature-info-value">${municipio}</span>
                    </div>` : ''}
                    <div class="feature-info-row">
                        <span class="feature-info-label">Batalhão / UEOP:</span>
                        <span class="feature-info-value"><span class="feature-badge badge-ueop">${ueop}</span></span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Comando (COB):</span>
                        <span class="feature-info-value"><span class="feature-badge badge-cob">${cob}</span></span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Fração:</span>
                        <span class="feature-info-value" style="font-size:11px;">${fracao}</span>
                    </div>
                    ${endereco ? `
                    <div class="feature-info-row" style="flex-direction:column;align-items:flex-start;">
                        <span class="feature-info-label">Endereço:</span>
                        <span class="feature-info-value" style="text-align:left;font-size:11px;">${endereco}</span>
                    </div>` : ''}
                    <div class="feature-info-row">
                        <span class="feature-info-label">Coordenadas:</span>
                        <span class="feature-info-value" style="font-size:11px;font-family:monospace;">${coordsStr}</span>
                    </div>
                </div>
            </div>
        `;
    }

    if (type === 'POLYGON') {
        const polyName = props.name || 'Circunscrição Territorial';
        const mun = props.NM_MUN || props.Field3 || '-';
        const codMun = props.CD_MUN ? `(IBGE ${props.CD_MUN})` : '';
        const area = props.AREA_KM2
            ? `${Number(props.AREA_KM2).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km²`
            : '-';
        const tipoFracao = props.Field8 ? `${props.Field8} - ${props.Field10 || ''}` : (props.Field10 || '-');
        const comando = props.Field7 || '-';
        const status = props.Field5
            ? `${props.Field5} ${props.Field11 ? '(' + props.Field11 + ')' : ''}`
            : (props.Field11 || '-');

        return `
            <div class="feature-card-header header-polygon">
                <h4 class="feature-card-title">🗺️ ${polyName}</h4>
                <span class="feature-type-tag">Área Territorial</span>
            </div>
            <div class="feature-card-body">
                <div class="feature-info-grid">
                    <div class="feature-info-row">
                        <span class="feature-info-label">Município Base:</span>
                        <span class="feature-info-value">${mun} ${codMun}</span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Área de Cobertura:</span>
                        <span class="feature-info-value" style="color:#2980b9;">${area}</span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Tipo da Fração:</span>
                        <span class="feature-info-value">${tipoFracao}</span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Comando / Unidade:</span>
                        <span class="feature-info-value"><span class="feature-badge badge-ueop">${comando}</span></span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Situação:</span>
                        <span class="feature-info-value">${status}</span>
                    </div>
                </div>
            </div>
        `;
    }

    return `
        <div class="feature-card-header">
            <h4 class="feature-card-title">📍 ${props.name || props['Nome da Unidade'] || props['Nome do Hospital'] || 'Feição'}</h4>
        </div>
        <div class="feature-card-body">
            <p>${props.description || 'Sem descrição adicional.'}</p>
        </div>
    `;
}

/**
 * Popup da feição. O botão "Rota até Aqui" respeita a direção correta:
 *  - UNIDADE_BM  → viatura sai da Unidade e vai ao endereço pesquisado (reverseRoute=true)
 *  - Demais      → rota do endereço pesquisado até a feição (reverseRoute=false)
 */
function formatFeaturePopup(feature) {
    const tooltipHtml = formatFeatureTooltip(feature);
    const coords = getFeatureCoords(feature);
    const props = feature.properties || {};
    const name = getFeatureDisplayName(feature).replace(/'/g, "\\'");
    const isPoint = feature.geometry && feature.geometry.type === 'Point';
    const classification = getFeatureClassification(feature);

    const closeBtnHtml = `
        <button type="button" class="btn-popup-close"
                onclick="if (typeof map !== 'undefined' && map) map.closePopup();"
                title="Fechar popup">×</button>
    `;

    const layerDbId = feature._layerDbId !== undefined ? feature._layerDbId : 'null';
    const featureIdx = feature._featureIndex !== undefined ? feature._featureIndex : 'null';

    const editBtnHtml =
        layerDbId !== 'null' && featureIdx !== 'null' && window.isAdmin
            ? `<button class="btn-popup-action btn-popup-edit"
                       onclick="window.openEditFeatureModal(${layerDbId}, ${featureIdx})">
                   ✏️ Editar Dados
               </button>`
            : '';

    let actionsHtml = '';

    if (isPoint && coords) {
        // ---------- Pontos (comportamento original) ----------
        const reverseRoute = classification === 'UNIDADE_BM';
        actionsHtml = `
            <div class="feature-popup-actions">
                <button class="btn-popup-action btn-popup-origin"
                        onclick="window.setOriginFromFeature(${coords.lat}, ${coords.lng}, '${name}')">
                    🎯 Definir Origem
                </button>
                <button class="btn-popup-action btn-popup-route"
                        onclick="window.routeToFeature(${coords.lng}, ${coords.lat}, '${name}', ${reverseRoute})">
                    🚗 Rota até Aqui
                </button>
                <button class="btn-popup-action btn-popup-copy"
                        onclick="window.copyFeatureCoords(${coords.lat}, ${coords.lng})">
                    📋 Copiar Coord.
                </button>
                ${editBtnHtml}
            </div>
        `;
    } else if (coords) {
        // ---------- Polígonos (eventos de fogo, macro/micro, articulação) ----------
        const evLat = (props.latitude  != null && props.latitude  !== '') ? Number(props.latitude)  : coords.lat;
        const evLng = (props.longitude != null && props.longitude !== '') ? Number(props.longitude) : coords.lng;
        const isEvent = classification === 'EVENTO_FOGO';
        const copyLabel = isEvent ? '📋 Copiar Coord. do Evento' : '📋 Copiar Coord. (centro)';

        actionsHtml = `
            <div class="feature-popup-actions">
                <button class="btn-popup-action btn-popup-origin"
                        onclick="window.setOriginFromFeature(${evLat}, ${evLng}, '${name}')">
                    🎯 Definir Origem
                </button>
                <button class="btn-popup-action btn-popup-route"
                        onclick="window.routeToFeature(${evLng}, ${evLat}, '${name}', false)">
                    🚗 Rota até Aqui
                </button>
                <button class="btn-popup-action btn-popup-copy"
                        onclick="window.copyFeatureCoords(${evLat}, ${evLng})">
                    ${copyLabel}
                </button>
                ${editBtnHtml}
            </div>
        `;
    }

    return `
        <div class="feature-popup-content-inner">
            ${closeBtnHtml}
            ${tooltipHtml}
            ${actionsHtml}
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Helpers internos reaproveitados nos dois caminhos (cluster / tradicional)
// ---------------------------------------------------------------------------
function _applyStyle(feature, isStreetLayer) {
    if (isStreetLayer) {
        return { color: '#64748b', weight: 1.3, opacity: 0.78, lineCap: 'round', lineJoin: 'round' };
    }
    const type = getFeatureClassification(feature);
    const props = feature.properties || {};

    if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
        if (type === 'EVENTO_FOGO') {
            const indice  = Number(props.indice_prioridade);
            const persist = Number(props.persistencia_dias) || 0;
            let fillColor = '#f39c12', strokeColor = '#b9770e', fillOpacity = 0.22, weight = 1.5;
            if (Number.isFinite(indice)) {
                if (indice >= 0.7)      { fillColor = '#c0392b'; strokeColor = '#7b241c'; fillOpacity = 0.35; weight = 2.2; }
                else if (indice >= 0.4) { fillColor = '#e67e22'; strokeColor = '#a04000'; fillOpacity = 0.28; weight = 1.8; }
                else                    { fillColor = '#f1c40f'; strokeColor = '#b7950b'; fillOpacity = 0.20; weight = 1.4; }
            } else if (String(props.status_evento || '').toLowerCase().includes('ativo')) {
                fillColor = '#e74c3c'; strokeColor = '#922b21'; fillOpacity = 0.30; weight = 2;
            }
            if (persist >= 5 && Number.isFinite(indice) && indice >= 0.7) weight = 2.8;
            return { fillColor, color: strokeColor, weight, opacity: 0.95, fillOpacity };
        }
        if (type === 'MICRORREGIAO') return { fillColor: '#27ae60', fillOpacity: 0.18, color: '#1e8449', weight: 1.2, opacity: 0.85 };
        if (type === 'MACRORREGIAO') return { fillColor: '#8e44ad', fillOpacity: 0.12, color: '#6c3483', weight: 1.8, opacity: 0.9 };
        return {
            fillColor: props.fill || '#0288d1',
            fillOpacity: props['fill-opacity'] !== undefined ? Number(props['fill-opacity']) : 0.3,
            color: props.stroke || '#0288d1',
            weight: props['stroke-width'] !== undefined ? Number(props['stroke-width']) : 1.5,
            opacity: props['stroke-opacity'] !== undefined ? Number(props['stroke-opacity']) : 1
        };
    }
    return {};
}

function _bindMarkerInteractions(marker, feature) {
    marker.bindTooltip(formatFeatureTooltip(feature), {
        sticky: true, className: 'feature-tooltip', direction: 'auto', opacity: 0.98
    });
    marker.bindPopup(formatFeaturePopup(feature), {
        className: 'feature-popup', maxWidth: 360, closeButton: false
    });
    marker.on('mouseover', () => {
        const type = resolveIconType(feature);
        const opts = (typeof buildIconOptsForFeature === 'function')
            ? buildIconOptsForFeature(feature, true) : { emphasis: true };
        marker.setIcon(createFeatureIcon(type, opts));
        marker.setZIndexOffset(1000);
    });
    marker.on('mouseout', () => {
        const type = resolveIconType(feature);
        const opts = (typeof buildIconOptsForFeature === 'function')
            ? buildIconOptsForFeature(feature, false) : {};
        marker.setIcon(createFeatureIcon(type, opts));
        marker.setZIndexOffset(0);
    });
    marker.on('click', (e) => {
        if (mapClickMode) { L.DomEvent.stopPropagation(e); handleFeatureClick(e, feature, marker); }
    });
}

function _bindPolygonInteractions(layer, feature, getParentGeoJSON) {
    const classification = getFeatureClassification(feature);
    // Eventos de fogo: tooltip não-sticky, para que o botão copiar
    // dentro dele permaneça ancorado e clicável.
    const isEvent = classification === 'EVENTO_FOGO';

    layer.bindTooltip(formatFeatureTooltip(feature), {
        sticky: !isEvent,
        className: 'feature-tooltip',
        direction: 'auto',
        opacity: 0.98
    });

    layer.bindPopup(formatFeaturePopup(feature), {
        className: 'feature-popup', maxWidth: 360, closeButton: false
    });

    layer.on('mouseover', function () {
        if (layer instanceof L.Marker) return;
        if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
            layer.setStyle({ weight: 3, color: '#f39c12', fillColor: '#f39c12', fillOpacity: 0.4 });
        }
    });
    layer.on('mouseout', function () {
        const parent = typeof getParentGeoJSON === 'function' ? getParentGeoJSON() : null;
        if (parent) parent.resetStyle(layer);
    });
    layer.on('click', (e) => {
        if (mapClickMode) { L.DomEvent.stopPropagation(e); handleFeatureClick(e, feature, layer); }
    });
}

// ---------------------------------------------------------------------------
// Ícone customizado de cluster (coerente com a paleta institucional)
// ---------------------------------------------------------------------------
function _clusterIconCreate(cluster) {
    const count = cluster.getChildCount();
    let size = 40, fontSize = 14;
    if (count >= 100) { size = 60; fontSize = 13; }
    else if (count >= 10) { size = 50; fontSize = 14; }

    return L.divIcon({
        html: `<div style="
            background: rgba(31,97,141,0.92);
            color:#fff; border-radius:50%;
            width:${size}px; height:${size}px;
            display:flex; align-items:center; justify-content:center;
            font-weight:700; font-size:${fontSize}px;
            border:3px solid rgba(255,255,255,0.85);
            box-shadow:0 3px 8px rgba(0,0,0,0.3);
            text-shadow:0 1px 2px rgba(0,0,0,0.4);
        ">${count}</div>`,
        className: 'marker-cluster-custom',
        iconSize: L.point(size, size)
    });
}

// ---------------------------------------------------------------------------
// addLayerToMap — única porta de entrada, decide cluster vs. tradicional
// ---------------------------------------------------------------------------
const CLUSTER_THRESHOLD = 150;   // acima disso, camadas de pontos usam cluster

function addLayerToMap(layerData, mode = viewMode, isStreetLayer = false) {
    if (!layerData.geojson || !map) return;

    if (Array.isArray(layerData.geojson.features)) {
        layerData.geojson.features.forEach((feat, idx) => {
            feat._layerDbId = layerData.id;
            feat._featureIndex = idx;
        });
    }

    const allFeatures = layerData.geojson.features || [];
    const pointFeatures    = allFeatures.filter(f => f?.geometry?.type === 'Point');
    const nonPointFeatures = allFeatures.filter(f => f?.geometry && f.geometry.type !== 'Point');

    const useCluster =
        !isStreetLayer &&
        typeof L.markerClusterGroup === 'function' &&
        pointFeatures.length >= CLUSTER_THRESHOLD;

    // =====================================================================
    // CAMINHO 1 — tradicional (L.geoJSON único) — mantido para compatibilidade
    // =====================================================================
    if (!useCluster) {
        const geojsonLayer = L.geoJSON(layerData.geojson, {
            filter: function (feature) {
                const classification = getFeatureClassification(feature);
                if (classification === 'MUNICIPIO') return false;
                if (mode === 'none') return false;
                if (mode === 'points') return feature.geometry.type === 'Point';
                return true;
            },
            style: (feature) => _applyStyle(feature, isStreetLayer),
            pointToLayer: (feature, latlng) => {
                const type = resolveIconType(feature);
                const opts = (typeof buildIconOptsForFeature === 'function')
                    ? buildIconOptsForFeature(feature, false) : {};
                return L.marker(latlng, {
                    icon: createFeatureIcon(type, opts),
                    riseOnHover: true, keyboard: true,
                    title: getFeatureDisplayName(feature)
                });
            },
            onEachFeature: (feature, layer) => {
                if (isStreetLayer) {
                    const info = getFeatureStreetInfo(feature.properties, layerData.name);
                    const name = info ? info.fullName : (feature.properties?.NM_LOG || 'Logradouro');
                    const mun = info ? info.munName : '';
                    layer.bindTooltip(`<strong>${name}</strong>${mun ? `<br><small>${mun}</small>` : ''}`, {
                        sticky: true, direction: 'top', opacity: 0.95, className: 'feature-tooltip'
                    });
                    layer.bindPopup(`<div style="font-family:sans-serif;font-size:13px;padding:4px 2px;"><strong>🛣️ ${name}</strong>${mun ? `<br><span style="color:#64748b;font-size:12px;">${mun} – MG</span>` : ''}</div>`, { maxWidth: 280 });
                    layer.on('mouseover', e => e.target.setStyle({ weight: 2.6, color: '#334155', opacity: 1 }));
                    layer.on('mouseout', e => geojsonLayer.resetStyle(e.target));
                    return;
                }
                if (layer instanceof L.Marker) {
	            _bindMarkerInteractions(layer, feature);
	        } else {
                     _bindPolygonInteractions(layer, feature, () => geojsonLayer);
	        }
            }
        });

        geojsonLayer.addTo(map);
        overlayLayers[layerData.id] = geojsonLayer;
        if (!isStreetLayer) {
            const hasPoints = pointFeatures.length > 0;
            if (hasPoints) geojsonLayer.bringToFront();
        } else {
            geojsonLayer.bringToBack();
        }
        return;
    }

    // =====================================================================
    // CAMINHO 2 — CLUSTERING (camadas de muitos pontos)
    // =====================================================================
    const wrapper = L.featureGroup();

    // (a) cluster de pontos
    if (mode !== 'none' && pointFeatures.length > 0) {
        const clusterGroup = L.markerClusterGroup({
            maxClusterRadius: 55,
            showCoverageOnHover: false,
            spiderfyOnMaxZoom: true,
            zoomToBoundsOnClick: true,
            removeOutsideVisibleBounds: true,
            chunkedLoading: true,
            chunkInterval: 200,          // ms por chunk → evita travar a UI
            chunkDelay: 50,
            disableClusteringAtZoom: 17, // a partir daqui, pinos soltos
            iconCreateFunction: _clusterIconCreate
        });

        const markers = [];
        pointFeatures.forEach(feature => {
            if (getFeatureClassification(feature) === 'MUNICIPIO') return;
            const latlng = L.latLng(feature.geometry.coordinates[1], feature.geometry.coordinates[0]);
            const type = resolveIconType(feature);
            const opts = (typeof buildIconOptsForFeature === 'function')
                ? buildIconOptsForFeature(feature, false) : {};
            const marker = L.marker(latlng, {
                icon: createFeatureIcon(type, opts),
                riseOnHover: true, keyboard: true,
                title: getFeatureDisplayName(feature)
            });
            _bindMarkerInteractions(marker, feature);
            markers.push(marker);
        });

        if (markers.length > 0) {
            clusterGroup.addLayers(markers);
        }

        wrapper.addLayer(clusterGroup);
    }

    // (b) polígonos/linhas seguem L.geoJSON (não entram no cluster)
    if (nonPointFeatures.length > 0 && mode !== 'none' && mode !== 'points') {
        const polyGeoJSON = { type: 'FeatureCollection', features: nonPointFeatures };
        const polyLayer = L.geoJSON(polyGeoJSON, {
            filter: f => getFeatureClassification(f) !== 'MUNICIPIO',
            style: (feature) => _applyStyle(feature, isStreetLayer),
            onEachFeature: (feature, layer) => {
                // getter preguiçoso — polyLayer é atribuído após o construtor retornar
                _bindPolygonInteractions(layer, feature, () => polyLayer);
            }
        });
        wrapper.addLayer(polyLayer);
    }

    wrapper.addTo(map);
    overlayLayers[layerData.id] = wrapper;

    if (!isStreetLayer) wrapper.bringToFront();
    else wrapper.bringToBack();
}

async function renameLayer(layerId) {
    const layer = await DB.getLayerById(layerId);
    if (!layer) return;
    const newName = prompt('Novo nome da camada:', layer.name);
    if (newName && newName.trim() && newName.trim() !== layer.name) {
        await DB.updateLayer(layerId, { name: newName.trim() });
        await reloadLayers();
        showToast(`Camada renomeada para "${newName.trim()}"`, 'success');
    }
}

async function duplicateLayer(layerId) {
    const layer = await DB.getLayerById(layerId);
    if (!layer) return;
    const newName = prompt('Nome da cópia:', layer.name + ' (cópia)');
    if (!newName || !newName.trim()) return;

    const geojsonCopy = JSON.parse(JSON.stringify(layer.geojson));
    await DB.saveLayer({
        name: newName.trim(),
        type: layer.type || 'geojson',
        geojson: geojsonCopy
    });
    await reloadLayers();
    showToast(`Camada "${newName.trim()}" criada com sucesso!`, 'success');
}

async function moveLayer(layerId, direction) {
    const layers = await DB.getLayers();
    const idx = layers.findIndex(l => l.id === layerId);
    if (idx === -1) return;

    let swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= layers.length) {
        showToast(direction === 'up' ? 'Já está no topo.' : 'Já está no final.', 'info');
        return;
    }

    const other = layers[swapIdx];
    await DB.swapLayerOrder(layerId, other.id);
    await reloadLayers();
    showToast('Ordem das camadas atualizada.', 'success');
}

function updateLayerListUI() {
    const ul = document.getElementById('layersUl');
    if (!ul) return;

    // Event delegation: um único listener persistente, imune a re-renders.
    // Isto resolve o bug "clique no olho não oculta" (closures obsoletas).
    if (ul.dataset.delegated !== 'true') {
        ul.dataset.delegated = 'true';
        ul.addEventListener('click', handleLayerListClick);
    }

    DB.getLayers().then(layers => {
        ul.innerHTML = '';
        const hiddenNames = ['RMBH', 'Ruas', 'Logradouros', 'Street'];
        const visibleLayers = layers.filter(layer => {
            if (!layer.name) return true;
            return !hiddenNames.some(k => layer.name.includes(k));
        });

        visibleLayers.forEach((layer, index) => {
            const isVisible = layerVisibility[layer.id] !== false;

            const li = document.createElement('li');
            li.className = 'layer-row' + (isVisible ? '' : ' layer-hidden');
            li.dataset.layerId = String(layer.id);
            li.dataset.visible = isVisible ? 'true' : 'false';

            // --- Pilha de ícones (clicável → enquadra a camada) ---
            const iconStack = document.createElement('button');
            iconStack.type = 'button';
            iconStack.className = 'layer-icon-stack';
            iconStack.dataset.action = 'zoom';
            iconStack.title = 'Enquadrar esta camada no mapa';
            iconStack.setAttribute('aria-label', `Enquadrar camada ${layer.name}`);
            if (typeof buildLayerIconHtml === 'function') {
                iconStack.innerHTML = buildLayerIconHtml(layer);
            }

            // --- Nome ---
            const nameSpan = document.createElement('span');
            nameSpan.className = 'layer-name';
            nameSpan.textContent = layer.name;
            nameSpan.title = layer.name;

            // --- Ações ---
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'layer-actions';

            const visBtn = document.createElement('button');
            visBtn.type = 'button';
            visBtn.className = 'layer-btn layer-btn-vis';
            visBtn.dataset.action = 'toggle';
            visBtn.title = isVisible ? 'Ocultar camada' : 'Exibir camada';
            visBtn.setAttribute('aria-label', visBtn.title);
            visBtn.setAttribute('aria-pressed', String(!isVisible));
            visBtn.innerHTML = isVisible ? UI_ICONS.eyeOpen : UI_ICONS.eyeClosed;
            actionsDiv.appendChild(visBtn);

            if (window.isAdmin) {
                const mkBtn = (action, title, svg, extraClass = '') => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'layer-btn' + (extraClass ? ` ${extraClass}` : '');
                    b.dataset.action = action;
                    b.title = title;
                    b.setAttribute('aria-label', title);
                    b.innerHTML = svg;
                    return b;
                };

                const renameBtn = mkBtn('rename',    'Renomear camada',  UI_ICONS.edit);
                const dupBtn    = mkBtn('duplicate', 'Duplicar camada',  UI_ICONS.copy);
                const upBtn     = mkBtn('up',        'Mover para cima',  UI_ICONS.up);
                const downBtn   = mkBtn('down',      'Mover para baixo', UI_ICONS.down);
                const delBtn    = mkBtn('delete',    'Excluir camada',   UI_ICONS.trash, 'layer-btn-danger');

                upBtn.disabled = index === 0;
                downBtn.disabled = index === visibleLayers.length - 1;
                [upBtn, downBtn].forEach(b => { b.style.opacity = b.disabled ? '0.35' : '1'; });

                actionsDiv.append(renameBtn, dupBtn, upBtn, downBtn, delBtn);
            }

            li.appendChild(iconStack);
            li.appendChild(nameSpan);
            li.appendChild(actionsDiv);
            ul.appendChild(li);
        });

        // Sincroniza chips flutuantes com o estado das camadas
        if (typeof updateMapChips === 'function') updateMapChips();
    });
}

/**
 * Listener ÚNICO (delegação) para todas as ações da lista de camadas.
 * Lê o estado ATUAL a cada clique — nunca usa closure obsoleta.
 */
async function handleLayerListClick(e) {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const li = actionEl.closest('li[data-layer-id]');
    if (!li) return;
    const layerId = Number(li.dataset.layerId);
    const action = actionEl.dataset.action;
    if (!layerId || !action) return;

    e.stopPropagation();

    switch (action) {
        case 'zoom': {
            const lyr = overlayLayers[layerId];
            if (!lyr || !map) return;
            if (typeof lyr.getBounds === 'function') {
                const bounds = lyr.getBounds();
                if (bounds && bounds.isValid()) {
                    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
                    return;
                }
            }
            showToast('Camada sem feições visíveis para enquadrar.', 'info');
            return;
        }
        case 'toggle': {
            // Lê o estado REAL no momento do clique — nunca capturado em closure
            const currentlyVisible = layerVisibility[layerId] !== false;
            layerVisibility[layerId] = !currentlyVisible;
            await reloadLayers();
            updateLayerListUI();
            return;
        }
        case 'rename':    await renameLayer(layerId); return;
        case 'duplicate': await duplicateLayer(layerId); return;
        case 'up':        await moveLayer(layerId, 'up'); return;
        case 'down':      await moveLayer(layerId, 'down'); return;
        case 'delete': {
            const layer = await DB.getLayerById(layerId);
            if (!layer) return;
            if (confirm(`Deseja excluir a camada "${layer.name}"?`)) {
                await DB.deleteLayer(layerId);
                invalidateLayerCategoryCache();
                await reloadLayers();
            }
            return;
        }
    }
}

// ===========================================================================
// CHIPS FLUTUANTES DE FILTRO POR CATEGORIA (Google-Maps-like)
// ===========================================================================

async function updateMapChips() {
    const container = document.getElementById('mapChips');
    if (!container) return;

    const layers = await DB.getLayers();
    const hiddenNames = ['RMBH', 'Ruas', 'Logradouros', 'Street'];
    const visibleLayers = layers.filter(layer => {
        if (!layer.name) return true;
        return !hiddenNames.some(k => layer.name.includes(k));
    });

    // Agrupa por categoria
    const byCategory = new Map();
    for (const layer of visibleLayers) {
        const cat = getLayerCategory(layer);
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(layer);
    }

    // Ordena categorias conforme preferência visual
    const categories = [...byCategory.keys()].sort((a, b) => {
        const ia = LAYER_CATEGORY_ORDER.indexOf(a);
        const ib = LAYER_CATEGORY_ORDER.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    container.innerHTML = '';
    for (const cat of categories) {
        const meta = LAYER_CATEGORY_META[cat] || LAYER_CATEGORY_META.OTHER;
        const layerList = byCategory.get(cat);
        const anyVisible = layerList.some(l => layerVisibility[l.id] !== false);
        const totalFeatures = layerList.reduce(
            (sum, l) => sum + (l.geojson?.features?.length || 0), 0
        );

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'map-chip' + (anyVisible ? ' active' : '');
        chip.dataset.category = cat;
        chip.style.setProperty('--chip-color', meta.color);
        chip.title = anyVisible ? `Ocultar ${meta.label}` : `Mostrar ${meta.label}`;
        chip.setAttribute('aria-pressed', String(anyVisible));
        chip.innerHTML = `
            <span class="map-chip-icon">${meta.icon}</span>
            <span class="map-chip-label">${meta.label}</span>
            <span class="map-chip-count">${totalFeatures}</span>
        `;
        chip.addEventListener('click', () => toggleLayerCategory(cat));
        container.appendChild(chip);
    }
}

async function toggleLayerCategory(category) {
    if (!category) return;
    const layers = await DB.getLayers();
    const matching = layers.filter(l => getLayerCategory(l) === category);
    if (matching.length === 0) return;

    const anyVisible = matching.some(l => layerVisibility[l.id] !== false);
    for (const l of matching) {
        layerVisibility[l.id] = !anyVisible;
    }

    await reloadLayers();
    updateLayerListUI();
    // updateMapChips() é re-chamado dentro de updateLayerListUI()

    const meta = LAYER_CATEGORY_META[category] || LAYER_CATEGORY_META.OTHER;
    showToast(
        anyVisible ? `${meta.label} ocultada(s).` : `${meta.label} exibida(s).`,
        'info', 1800
    );
}

// ===========================================================================
// BUSCADOR DE ÁREAS BM — com agrupamento hierárquico (COB → BBM/CIA IND)
// ---------------------------------------------------------------------------
// Retorna DOIS níveis:
//   • groups      → agrupamentos por COB pai (ex.: "1º COB" contendo BBM/CIA)
//   • individuals → feições isoladas (comportamento anterior)
//
// A detecção do COB pai é feita por `extractCOBLabel()`, que varre múltiplos
// campos possíveis do schema (Field7, Field10, COB, COB / CEB, etc.) em
// busca do padrão "Nº COB".
// ===========================================================================

/**
 * Normalização canônica para comparações de busca — unificada.
 *
 * Regras aplicadas em sequência:
 *   1. NFD + remove diacríticos  → "São" → "sao"
 *   2. Minúsculas
 *   3. Remove ordinalizadores    → "1º" / "1°" / "1ª" → "1"
 *      (mas preserva "o" e "a" como letras quando NÃO são ordinais)
 *   4. Insere espaço entre dígito↔letra e letra↔dígito
 *      → "1COB" → "1 COB" | "BBM2" → "BBM 2"
 *   5. Colapsa espaços múltiplos
 *
 * Resultado para todas as formas do usuário:
 *   "1º COB" → "1 cob"
 *   "1 COB"  → "1 cob"
 *   "1COB"   → "1 cob"
 *   "1º BBM" → "1 bbm"
 *   "1BBM"   → "1 bbm"
 */
function _normalizeSearchText(s) {
    if (s == null) return '';
    let t = String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    t = t.toLowerCase();

    // Ordinalizadores: "1º" "1°" "1ª" → "1"
    // Regex só remove quando precedido por dígito, preservando "1o" como letra em outras palavras.
    t = t.replace(/(\d)\s*[º°ª]/g, '$1 ');

    // Insere espaço entre dígito↔letra (ambas as direções)
    t = t.replace(/(\d)([a-z])/g, '$1 $2');
    t = t.replace(/([a-z])(\d)/g, '$1 $2');

    // Colapsa espaços + trim
    return t.replace(/\s+/g, ' ').trim();
}

/**
 * Compatibilidade retroativa — delega para a normalização unificada.
 * Mantida porque o nome é usado em outros pontos do código.
 */
function _normalizeCOBString(s) {
    return _normalizeSearchText(s);
}

/**
 * Gera a versão compacta (sem espaços) — usada como "segunda chave"
 * de comparação. Isso garante que "1 cob", "1cob" e "1ºcob" batam.
 */
function _compactKey(s) {
    return _normalizeSearchText(s).replace(/\s+/g, '');
}

/**
 * Extrai o rótulo do COB pai de uma feature poligonal.
 * Retorna string canônica (ex.: "1º COB") ou null.
 */
function extractCOBLabel(props) {
    if (!props) return null;

    // 1. Campos diretos dedicados a COB
    const direct = props.COB
        || props['COB / CEB']
        || props.Comando_COB
        || props.cobOperacional
        || props.comandoOperacional;
    if (direct) {
        const s = String(direct).trim();
        if (s && s !== '-') return s;
    }

    // 2. Varredura em campos descritivos pelo padrão "Nº COB"
    const searchables = [
        props.Field7,   // Comando / Batalhão
        props.Field10,  // Denominação Completa da Fração
        props.Field8,   // Tipo da Fração
        props.name,
        props['Denominação Completa'],
        props.description
    ];

    for (const v of searchables) {
        if (v == null) continue;
        const s = String(v);
        // Aceita: "1º COB", "1o COB", "1 COB BM", "1° COB Bombeiros"
        const m = s.match(/(\d+\s*[ºo°ª]?\s*COB(?:\s*(?:BM|BOMBEIROS?))?)/i);
        if (m) {
            // Canonicaliza: "1 COB" → "1º COB"
            const numMatch = m[1].match(/(\d+)/);
            if (numMatch) return `${numMatch[1]}º COB`;
        }
    }

    return null;
}

/**
 * Extrai rótulo resumido da subunidade (BBM / CIA IND) para exibir
 * na lista de membros do grupo.
 */
function extractUnitLabel(props) {
    if (!props) return 'Unidade';
    return (
        props.name ||
        props.Field10 ||
        props.Field8 ||
        props['Denominação Completa'] ||
        'Unidade'
    ).toString().trim();
}

async function searchAreasBM(query) {
    const rawQuery = String(query || '').trim();
    if (rawQuery.length < 2) return { groups: [], individuals: [] };

    // Duas representações da query — espaçada e compacta.
    // Isso garante match independentemente de o usuário digitar
    // "1 COB", "1º COB" ou "1COB".
    const qNorm    = _normalizeSearchText(rawQuery);   // "1 cob"
    const qCompact = qNorm.replace(/\s+/g, '');        // "1cob"

    if (qNorm.length < 2) return { groups: [], individuals: [] };

    const layers = await DB.getLayers();
    const allPolygons = [];       // pool completo (para agrupar)
    const individuals = [];        // matches individuais

    for (const layer of layers) {
        if (!layer?.geojson?.features) continue;
        for (let i = 0; i < layer.geojson.features.length; i++) {
            const f = layer.geojson.features[i];
            const geom = f.geometry;
            if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;

            const classification = typeof getFeatureClassification === 'function'
                ? getFeatureClassification(f)
                : 'OTHER';
            if (classification !== 'POLYGON' &&
                classification !== 'MACRORREGIAO' &&
                classification !== 'MICRORREGIAO') continue;

            const props = f.properties || {};
            const record = {
                layerId: layer.id,
                layerName: layer.name,
                featureIndex: i,
                feature: f,
                props
            };
            allPolygons.push(record);

            // ---------- Match individual (tolerante) ----------
            const partsRaw = [
                props.name,
                props.Field7,
                props.Field8,
                props.Field10,
                props.NM_MUN,
                props.Macrorregiao_Saude,
                props['Microrregião de Saúde']
            ].filter(Boolean);

            const haystackRaw     = partsRaw.join(' ');
            const haystackNorm    = _normalizeSearchText(haystackRaw);   // "1 cob 1 bbm ..."
            const haystackCompact = haystackNorm.replace(/\s+/g, '');    // "1cob1bbm..."

            const matchesIndividual =
                haystackNorm.includes(qNorm) ||
                haystackCompact.includes(qCompact);

            if (!matchesIndividual) continue;

            const title = props.name || props.Field10 || props.Field7 || 'Área';
            const subtitle = [
                props.Field8 ? `Tipo: ${props.Field8}` : '',
                props.Field7 ? `Comando: ${props.Field7}` : '',
                props.NM_MUN ? `Mun.: ${props.NM_MUN}` : ''
            ].filter(Boolean).join(' • ');

            individuals.push({
                type: 'feature',
                layerId: layer.id,
                featureIndex: i,
                feature: f,
                title,
                subtitle,
                layerName: layer.name
            });
        }
    }

    // -----------------------------------------------------------------------
    // AGRUPAMENTO HIERÁRQUICO POR COB (match tolerante nos dois lados)
    // -----------------------------------------------------------------------
    const groupsMap = new Map();
    for (const rec of allPolygons) {
        const cobLabel = extractCOBLabel(rec.props);
        if (!cobLabel) continue;
        const key = _normalizeSearchText(cobLabel);
        if (!groupsMap.has(key)) {
            groupsMap.set(key, { label: cobLabel, members: [], unitLabels: [] });
        }
        const g = groupsMap.get(key);
        g.members.push(rec);
        g.unitLabels.push(extractUnitLabel(rec.props));
    }

    const groups = [];
    for (const [, g] of groupsMap) {
        const labelNorm    = _normalizeSearchText(g.label);
        const labelCompact = labelNorm.replace(/\s+/g, '');

        const matches =
            labelNorm.includes(qNorm)     ||
            qNorm.includes(labelNorm)     ||
            labelCompact.includes(qCompact) ||
            qCompact.includes(labelCompact);

        if (!matches) continue;
        if (g.members.length < 2) continue;   // grupo requer 2+ subunidades

        const uniqUnits = Array.from(new Set(g.unitLabels));

        groups.push({
            type: 'group',
            label: g.label,
            count: g.members.length,
            members: g.members,
            memberLabels: uniqUnits,
            previewText: uniqUnits.slice(0, 5).join(' · ') +
                (uniqUnits.length > 5 ? ` +${uniqUnits.length - 5}` : '')
        });
    }

    // Ordena grupos por número de membros (mais abrangente primeiro)
    groups.sort((a, b) => b.count - a.count);

    // Ordena indivíduos por relevância (prefixo normalizado tem prioridade)
    individuals.sort((a, b) => {
        const at = _normalizeSearchText(a.title);
        const bt = _normalizeSearchText(b.title);
        const aStarts = at.startsWith(qNorm) ? 0 : 1;
        const bStarts = bt.startsWith(qNorm) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return at.localeCompare(bt);
    });

    return {
        groups,
        individuals: individuals.slice(0, 30)
    };
}

/**
 * Enquadra e destaca UMA OU MAIS feições simultaneamente.
 * Aceita Feature único ou array de Features.
 */
function fitBoundsToFeatures(features) {
    if (!map) return;
    const arr = Array.isArray(features) ? features : [features];
    if (arr.length === 0) return;

    try {
        // Calcula bounds unificados
        const wrapper = L.geoJSON({
            type: 'FeatureCollection',
            features: arr
        });
        const bounds = wrapper.getBounds();
        if (!bounds || !bounds.isValid()) return;

        // Zoom máximo adaptativo: grupos maiores → zoom um pouco menor
        const maxZoom = arr.length > 6 ? 11 : (arr.length > 2 ? 12 : 14);

        map.fitBounds(bounds, { padding: [40, 40], maxZoom });

        // Destaque visual temporário (todas as feições em conjunto)
        const highlight = L.geoJSON({
            type: 'FeatureCollection',
            features: arr
        }, {
            style: {
                color: '#f39c12',
                weight: 3.5,
                fillColor: '#f39c12',
                fillOpacity: 0.18,
                dashArray: '8,5'
            },
            interactive: false
        }).addTo(map);

        // Tempo proporcional ao número de feições (entre 3,5 s e 6 s)
        const holdMs = Math.min(6000, 3500 + arr.length * 250);
        setTimeout(() => {
            try { map.removeLayer(highlight); } catch (_) {}
        }, holdMs);
    } catch (e) {
        console.warn('Erro ao enquadrar feições:', e);
    }
}

// Compatibilidade retroativa: função antiga delega para a nova
function fitBoundsToFeature(feature) {
    fitBoundsToFeatures(feature);
}

function initAreaSearch() {
    if (!map || typeof L === 'undefined') return;

    // Controle Leaflet no canto superior direito
    const AreaSearchControl = L.Control.extend({
        options: { position: 'topright' },
        onAdd: function () {
            const btn = L.DomUtil.create('button', 'leaflet-control-area-search');
            btn.type = 'button';
            btn.innerHTML = '🔎';
            btn.title = 'Buscar área BM (COB / BBM / CIA IND)';
            btn.setAttribute('aria-label', 'Buscar área BM');
            L.DomEvent.disableClickPropagation(btn);
            L.DomEvent.on(btn, 'click', (ev) => {
                L.DomEvent.stop(ev);
                if (typeof window.openAreaSearchPanel === 'function') {
                    window.openAreaSearchPanel();
                }
            });
            return btn;
        }
    });
    map.addControl(new AreaSearchControl());

    const panel    = document.getElementById('areaSearchPanel');
    const input    = document.getElementById('areaSearchInput');
    const results  = document.getElementById('areaSearchResults');
    const closeBtn = document.getElementById('areaSearchClose');
    if (!panel || !input || !results) return;

        let debounce = null;
    let currentResult = { groups: [], individuals: [] };

    const _esc = (typeof escapeHtml === 'function')
        ? escapeHtml
        : (s => String(s ?? ''));

    const renderMatches = (result) => {
        const groups = result?.groups || [];
        const individuals = result?.individuals || [];

        if (groups.length === 0 && individuals.length === 0) {
            results.innerHTML = '<div class="area-search-empty">Nenhuma área encontrada.</div>';
            return;
        }

        let html = '';

        // ---------- GRUPOS (COB) primeiro ----------
        if (groups.length > 0) {
            html += `<div class="area-search-section-label">📦 Grupos de articulação</div>`;
            html += groups.map((g, gi) => `
                <button type="button" class="area-search-item area-search-item-group"
                        data-group-index="${gi}">
                    <div class="area-search-item-head">
                        <span class="area-search-item-title">📦 ${_esc(g.label)}</span>
                        <span class="area-search-item-count">${g.count}</span>
                    </div>
                    <div class="area-search-item-sub">${_esc(g.previewText)}</div>
                </button>
            `).join('');
        }

        // ---------- FEIÇÕES INDIVIDUAIS ----------
        if (individuals.length > 0) {
            html += `<div class="area-search-section-label">📍 Feições individuais</div>`;
            html += individuals.map((m, i) => `
                <button type="button" class="area-search-item" data-item-index="${i}">
                    <div class="area-search-item-title">📍 ${_esc(m.title)}</div>
                    ${m.subtitle ? `<div class="area-search-item-sub">${_esc(m.subtitle)}</div>` : ''}
                </button>
            `).join('');
        }

        results.innerHTML = html;

        // Handlers — grupos (fitBounds sobre TODAS as feições do COB)
        results.querySelectorAll('.area-search-item-group').forEach(btn => {
            btn.addEventListener('click', () => {
                const gi = Number(btn.dataset.groupIndex);
                const group = currentResult.groups[gi];
                if (!group) return;
                const features = group.members.map(m => m.feature);
                fitBoundsToFeatures(features);
                if (typeof showToast === 'function') {
                    showToast(
                        `${group.label} — ${group.count} feições destacadas.`,
                        'success', 2800
                    );
                }
                panel.classList.add('hidden');
            });
        });

        // Handlers — feições individuais
        results.querySelectorAll('.area-search-item[data-item-index]').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = Number(btn.dataset.itemIndex);
                const match = currentResult.individuals[i];
                if (!match) return;
                fitBoundsToFeatures([match.feature]);
                panel.classList.add('hidden');
            });
        });
    };

    const runSearch = async () => {
        const q = input.value.trim();
        if (q.length < 2) {
            results.innerHTML = '';
            currentResult = { groups: [], individuals: [] };
            return;
        }
        results.innerHTML = '<div class="area-search-empty">🔎 Buscando...</div>';
        currentResult = await searchAreasBM(q);
        renderMatches(currentResult);
    };

    input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(runSearch, 250);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            clearTimeout(debounce);
            runSearch();
        }
        if (e.key === 'Escape') {
            panel.classList.add('hidden');
            input.blur();
        }
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
    }

    document.addEventListener('click', (e) => {
        if (panel.classList.contains('hidden')) return;
        if (!panel.contains(e.target) &&
            !e.target.closest('.leaflet-control-area-search')) {
            panel.classList.add('hidden');
        }
    });

    window.openAreaSearchPanel = () => {
        panel.classList.remove('hidden');
        input.focus();
        input.select();
    };
}

function setViewMode(mode) {
    viewMode = mode;
    reloadLayers();
}

function syncViewCheckboxes(mode) {
    document.querySelectorAll('.view-checkbox').forEach(cb => {
        cb.checked = cb.dataset.mode === mode;
    });
}

function handleFeatureClick(e, feature, layer) {
    if (mapClickMode) {
        L.DomEvent.stopPropagation(e);

        if (typeof window.exitMapOriginMode === 'function') {
            window.exitMapOriginMode(true);
        } else {
            mapClickMode = false;
            const btn = document.getElementById('mapOriginBtn');
            if (btn) btn.textContent = '🎯 Ponto no mapa';
            if (map) map.getContainer().style.cursor = '';
        }

        const latlng = e.latlng;
        setOrigin(latlng.lat, latlng.lng, 'Origem manual (clique na feição)');
        map.setView([latlng.lat, latlng.lng], 15);
        calculateDistancesToAllFeatures(latlng.lat, latlng.lng);
        showToast('Origem definida.', 'success');
        return;
    }

    if (!originMarker && feature.geometry.type === 'Point') {
        const coords = feature.geometry.coordinates;
        setOrigin(coords[1], coords[0], feature.properties?.name || feature.properties?.['Nome do Hospital'] || 'Ponto selecionado');
        map.setView([coords[1], coords[0]], 15);
        calculateDistancesToAllFeatures(coords[1], coords[0]);
        return;
    }

    if (originMarker) {
        drawRouteOrLine(feature);
    } else {
        showToast('Defina uma origem primeiro (busca, GPS ou clique no mapa).', 'warning');
    }
}

/**
 * Desenha rota/linha entre origem e a feição clicada.
 * Respeita a direção correta: Unidades BM → origem pesquisada.
 * Durante a visualização, esconde feições (polígonos) para priorizar pontos.
 */
function drawRouteOrLine(feature) {
    if (feature.geometry.type !== 'Point') {
        showToast('Apenas feições do tipo Ponto suportam cálculo de rota no clique.', 'info');
        return;
    }

    // 👇 Esconde feições (polígonos) durante a rota.
    if (typeof window.enterRouteViewMode === 'function') {
        // Não awaited (função sync), a troca de camadas ocorre em background
        window.enterRouteViewMode();
    }

    const coords = feature.geometry.coordinates;
    const destLng = coords[0];
    const destLat = coords[1];
    const name =
        feature.properties?.name ||
        feature.properties?.['Nome do Hospital'] ||
        'Destino selecionado';

    const originPos = originMarker.getLatLng();
    const from = turf.point([originPos.lng, originPos.lat]);
    const to = turf.point([destLng, destLat]);
    const distance = turf.distance(from, to, { units: 'kilometers' });

    const classification = getFeatureClassification(feature);
    const reverseRoute = classification === 'UNIDADE_BM';

    focusOnFeature(destLng, destLat, name, distance, reverseRoute);
}
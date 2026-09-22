// js/chamadas.js - Importação de chamadas operacionais CBMMG via CSV
// Suporta o layout exportado do sistema de despacho (delimitador ';').
// Corrige mojibake comum (ş → º, ă → ã, Ŕ → À) e normaliza cabeçalhos.

const CHAMADAS_LAYER_NAME  = 'Chamadas CBMMG';
const CHAMADAS_LAYER_ORDER = 45;  // entre Articulação (10) e Unidades (100)

// ---------------------------------------------------------------------------
// Correção de mojibake específico dos exports do sistema CBMMG
// ---------------------------------------------------------------------------
function fixMojibake(str) {
    if (!str) return '';
    return String(str)
        .replace(/\u015f/g, '\u00ba')   // ş → º
        .replace(/\u015e/g, '\u00ba')   // Ş → º
        .replace(/\u0103/g, '\u00e3')   // ă → ã
        .replace(/\u0102/g, '\u00c3')   // Ă → Ã
        .replace(/\u0154/g, '\u00c0');  // Ŕ → À
}

// ---------------------------------------------------------------------------
// Normalização de cabeçalhos (tolerante a acentos e variações)
// ---------------------------------------------------------------------------
function normalizeHeader(h) {
    return fixMojibake(String(h || ''))
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .trim();
}

// Mapeamento: cabeçalho normalizado → chave canônica
const CHAMADAS_HEADER_MAP = {
    'n chamada': 'numChamada',
    'no chamada': 'numChamada',
    'num chamada': 'numChamada',
    'numero chamada': 'numChamada',
    'n reds': 'numREDS',
    'no reds': 'numREDS',
    'num reds': 'numREDS',
    'numero reds': 'numREDS',
    'data hora de criacao': 'dataCriacao',
    'data hora criacao': 'dataCriacao',
    'local do fato': 'localFato',
    'latitude do local': 'latitude',
    'latitude': 'latitude',
    'lat': 'latitude',
    'longitude do local': 'longitude',
    'longitude': 'longitude',
    'lon': 'longitude',
    'lng': 'longitude',
    'natureza': 'natureza',
    'unidade responsavel': 'unidadeResponsavel',
    'recursos empenhados': 'recursosEmpenhados',
    'alerta': 'alerta',
    'destaque': 'destaque',
    'envolve autoridade': 'envolveAutoridade',
    'tipo de classificacao': 'tipoClassificacao',
    'tipo classificacao': 'tipoClassificacao',
    'situacao': 'situacao',
    'data hora da situacao atual': 'dataSituacaoAtual',
    'data hora situacao atual': 'dataSituacaoAtual',
    'evento associado': 'eventoAssociado'
};

// ---------------------------------------------------------------------------
// Parser CSV (respeita aspas, detecta delimitador)
// ---------------------------------------------------------------------------
function detectDelimiter(line) {
    const counts = {
        ';': (line.match(/;/g)  || []).length,
        ',': (line.match(/,/g)  || []).length,
        '\t': (line.match(/\t/g) || []).length
    };
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function parseCSVLine(line, delimiter) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (c === delimiter && !inQuotes) {
            out.push(cur); cur = '';
        } else {
            cur += c;
        }
    }
    out.push(cur);
    return out.map(s => s.trim());
}

// ---------------------------------------------------------------------------
// Data BR "DD/MM/YYYY HH:MM:SS" → ISO
// ---------------------------------------------------------------------------
function parseDateBR(str) {
    const m = String(str || '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    try {
        return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`).toISOString();
    } catch { return null; }
}

// ---------------------------------------------------------------------------
// Cor/estilo por situação operacional
// ---------------------------------------------------------------------------
function getChamadaSituationStyle(situacao) {
    const s = normalizeHeader(situacao);
    if (s.includes('terminada'))                       return { key: 'terminada', color: '#7f8c8d', border: '#5d6d7e', label: situacao || 'Terminada' };
    if (s.includes('em controle'))                     return { key: 'controle',  color: '#27ae60', border: '#1e8449', label: situacao || 'Em controle' };
    if (s.includes('no local'))                        return { key: 'nolocal',   color: '#e67e22', border: '#a04000', label: situacao || 'No local' };
    if (s.includes('caminho'))                         return { key: 'caminho',   color: '#f1c40f', border: '#b7950b', label: situacao || 'À caminho' };
    if (s.includes('atribuida') && s.includes('orgao'))return { key: 'orgao',     color: '#8e44ad', border: '#6c3483', label: situacao || 'Atribuída ao órgão' };
    return { key: 'outro', color: '#e74c3c', border: '#922b21', label: situacao || 'Outra' };
}

// ---------------------------------------------------------------------------
// Parser principal: texto CSV → features GeoJSON
// ---------------------------------------------------------------------------
function parseChamadasCSV(text) {
    text = String(text || '').replace(/^\uFEFF/, '');   // remove BOM
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { features: [], skipped: 0, total: 0 };

    const delimiter = detectDelimiter(lines[0]);
    const rawHeaders = parseCSVLine(lines[0], delimiter);
    const mapped = rawHeaders.map(h => CHAMADAS_HEADER_MAP[normalizeHeader(h)] || null);

    const features = [];
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i], delimiter);
        const record = {};
        mapped.forEach((key, idx) => {
            if (key) record[key] = fixMojibake(values[idx] || '');
        });

        const lat = parseFloat(String(record.latitude  || '').replace(',', '.'));
        const lng = parseFloat(String(record.longitude || '').replace(',', '.'));
        if (!isFinite(lat) || !isFinite(lng) ||
            Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            skipped++;
            continue;
        }

        const props = {
            _tipo: 'CHAMADA',
            numChamada: record.numChamada || '',
            numREDS: record.numREDS || '',
            dataCriacao: parseDateBR(record.dataCriacao),
            dataCriacaoTexto: record.dataCriacao || '',
            localFato: record.localFato || '',
            natureza: record.natureza || '',
            unidadeResponsavel: record.unidadeResponsavel || '',
            recursosEmpenhados: record.recursosEmpenhados || '',
            alerta: record.alerta || '',
            destaque: record.destaque || '',
            envolveAutoridade: record.envolveAutoridade || '',
            tipoClassificacao: record.tipoClassificacao || '',
            situacao: record.situacao || '',
            dataSituacaoAtual: parseDateBR(record.dataSituacaoAtual),
            dataSituacaoAtualTexto: record.dataSituacaoAtual || '',
            eventoAssociado: record.eventoAssociado || '',
            name: `Chamada ${record.numChamada || 's/n'}`
        };

        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: props
        });
    }

    return { features, skipped, total: lines.length - 1 };
}

// ---------------------------------------------------------------------------
// Importa o CSV para o IndexedDB (com ou sem substituição)
// ---------------------------------------------------------------------------
async function importChamadasCSV(file, options = {}) {
    const { replaceExisting = false } = options;

    const text = await file.text();
    const { features, skipped, total } = parseChamadasCSV(text);

    if (!features.length) {
        showToast(`Nenhuma chamada com coordenadas válidas (${skipped} linhas ignoradas).`, 'warning', 5000);
        return { ok: false, imported: 0, skipped, total };
    }

    const existingLayers = await DB.getLayers();
    const existing = existingLayers.find(l => l.name === CHAMADAS_LAYER_NAME);

    if (existing && replaceExisting) {
        await DB.updateLayer(existing.id, {
            geojson: { type: 'FeatureCollection', features }
        });
        await reloadLayers();
        showToast(
            `Camada "${CHAMADAS_LAYER_NAME}" atualizada: ${features.length} chamada(s)` +
            (skipped ? ` • ${skipped} sem coordenadas` : ''),
            'success', 5000
        );
        return { ok: true, imported: features.length, skipped, total, replaced: true };
    }

    const stamp = new Date().toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    }).replace(/[/:\s]/g, '-');

    const layerName = existing ? `${CHAMADAS_LAYER_NAME} ${stamp}` : CHAMADAS_LAYER_NAME;

    await DB.saveLayer({
        name: layerName,
        type: 'geojson',
        order: CHAMADAS_LAYER_ORDER,
        geojson: { type: 'FeatureCollection', features }
    });
    await reloadLayers();
    showToast(
        `Camada "${layerName}" criada: ${features.length} chamada(s)` +
        (skipped ? ` • ${skipped} sem coordenadas` : ''),
        'success', 5000
    );
    return { ok: true, imported: features.length, skipped, total, replaced: false };
}

// ---------------------------------------------------------------------------
// Wire-up do botão dedicado "Importar Chamadas (CSV)"
// ---------------------------------------------------------------------------
function setupChamadasImportUI() {
    const btn = document.getElementById('importChamadasBtn');
    const input = document.getElementById('chamadasFileInput');
    if (!btn || !input) return;

    btn.addEventListener('click', () => input.click());

    input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file || !window.isAdmin) return;

        let replaceExisting = false;
        try {
            const layers = await DB.getLayers();
            const existing = layers.find(l => l.name === CHAMADAS_LAYER_NAME);
            if (existing) {
                const qty = existing.geojson?.features?.length || 0;
                replaceExisting = confirm(
                    `Já existe a camada "${CHAMADAS_LAYER_NAME}" com ${qty} chamada(s).\n\n` +
                    `OK = SUBSTITUIR os dados existentes\n` +
                    `Cancelar = CRIAR NOVA camada com data/hora`
                );
            }
            await importChamadasCSV(file, { replaceExisting });
        } catch (err) {
            console.error('Erro ao importar chamadas:', err);
            showToast('Erro ao importar CSV: ' + err.message, 'error', 5000);
        }
    });
}

// Exposições globais
window.importChamadasCSV        = importChamadasCSV;
window.parseChamadasCSV         = parseChamadasCSV;
window.getChamadaSituationStyle = getChamadaSituationStyle;
window.setupChamadasImportUI    = setupChamadasImportUI;
window.CHAMADAS_LAYER_NAME      = CHAMADAS_LAYER_NAME;
// js/eventos.js
// Eventos de Fogo (ativos ou em observação) — somente Minas Gerais
// Fonte: Painel do Fogo / CENSIPAM — API OpenAPI v1
// Estratégia: filtro nativo no servidor (?sigla_estado=MG) + atualização a cada 2h

// js/eventos.js — Cloudflare Worker (produção)
const EVENTOS_API_BASE = 'https://painel-fogo-proxy.pesmesquita.workers.dev';
const EVENTOS_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;  // 2 horas
const EVENTOS_UF = 'MG';
const EVENTOS_LAYER_NAME = 'Eventos de Fogo - MG';
const EVENTOS_LAYER_ORDER = 47;                          // entre Unidades BM e demais camadas
const EVENTOS_STORAGE_KEY = 'eventos_mg_last_fetch';

// Bounding box aproximado de MG (para a rota de prioridades)
const EVENTOS_MG_BBOX = '-51.05,-22.92,-39.85,-14.23';   // xMin,yMin,xMax,yMax

let eventosRefreshTimer = null;
let eventosPrioridadesMap = new Map();  // id_evento → objeto de prioridade

// ---------------------------------------------------------------------------
// Conversão: EventSchema[] → FeatureCollection
// ---------------------------------------------------------------------------
function eventosToGeoJSON(eventos) {
    if (!Array.isArray(eventos)) return { type: 'FeatureCollection', features: [] };

    const features = [];
    for (const ev of eventos) {
        const geom = ev.geom;
        if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;

        // Remove CRS interno (fora do padrão GeoJSON e ruído para o Leaflet)
        const cleanGeom = { type: geom.type, coordinates: geom.coordinates };

        const { geom: _g, retangulo_envolvente: _r, ...rest } = ev;

        const props = { ...rest, _tipo: 'EVENTO_FOGO', _uf: EVENTOS_UF };

        // Enriquece com índice de prioridade, se disponível
        const prio = eventosPrioridadesMap.get(ev.id_evento);
        if (prio) {
            props.indice_prioridade = prio.indice;
            props.indice_variacao   = prio.variacao_absoluta;
            props.indice_referencia = prio.indice_referencia;
            props.indice_dt_maxima  = prio.dt_maxima;
        }

        features.push({
            type: 'Feature',
            geometry: cleanGeom,
            properties: props
        });
    }
    return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// Fetch dos endpoints
// ---------------------------------------------------------------------------
async function fetchEventosMG() {
    const url = `${EVENTOS_API_BASE}/eventos?sigla_estado=${EVENTOS_UF}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
        const res = await fetch(url, {
            method: 'GET',
            mode: 'cors',
            headers: { 'Accept': 'application/json' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
            console.warn(`[Eventos] HTTP ${res.status}`);
            return null;
        }
        const data = await res.json();
        return Array.isArray(data) ? data : null;
    } catch (e) {
        clearTimeout(timeoutId);
        console.warn('[Eventos] Falha ao buscar eventos:', e.message);
        return null;
    }
}

/**
 * Busca os índices de prioridade dos eventos para MG.
 *
 * O endpoint /eventos/prioridades historicamente rejeitou o parâmetro `bbox`
 * com HTTP 400. Como /eventos?sigla_estado=MG é o filtro já validado para o
 * endpoint principal, replicamos aqui esse mesmo padrão como primeira
 * tentativa e mantemos fallbacks progressivos.
 *
 * Em caso de falha total, retorna null — o app segue funcionando, apenas
 * sem o enriquecimento de prioridade (badge ★, coloração por criticidade).
 */
async function fetchPrioridadesMG() {
    const attempts = [
        // 1. Mesmo filtro do endpoint principal (alta probabilidade de sucesso)
        `${EVENTOS_API_BASE}/eventos/prioridades?sigla_estado=${EVENTOS_UF}`,
        // 2. Com sigla_estado + limite
        `${EVENTOS_API_BASE}/eventos/prioridades?sigla_estado=${EVENTOS_UF}&limite=500`,
        // 3. Sem nenhum parâmetro (endpoint pode ter default)
        `${EVENTOS_API_BASE}/eventos/prioridades`
    ];

    for (let i = 0; i < attempts.length; i++) {
        const url = attempts[i];
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const res = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                headers: { 'Accept': 'application/json' },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
                console.warn(`[Eventos] prioridades tentativa ${i + 1} falhou (HTTP ${res.status}) → ${url}`);
                continue;
            }

            const data = await res.json();
            if (Array.isArray(data)) {
                console.log(`[Eventos] prioridades carregadas na tentativa ${i + 1} (${data.length} registros).`);
                return data;
            }
            console.warn(`[Eventos] prioridades tentativa ${i + 1} retornou formato inesperado:`, typeof data);
        } catch (e) {
            clearTimeout(timeoutId);
            console.warn(`[Eventos] prioridades tentativa ${i + 1} erro: ${e.message}`);
        }
    }

    console.warn('[Eventos] Todas as tentativas de carregar prioridades falharam. Prosseguindo sem enriquecimento.');
    return null;
}

// ---------------------------------------------------------------------------
// Persistência (upsert)
// ---------------------------------------------------------------------------
async function upsertEventosLayer(name, geojson, order) {
    const layers = await DB.getLayers();
    const existing = layers.find(l => l.name === name);
    if (existing) {
        await DB.updateLayer(existing.id, { geojson });
        return existing.id;
    }
    return await DB.saveLayer({ name, type: 'geojson', order, geojson });
}

// ---------------------------------------------------------------------------
// Refresh principal
// ---------------------------------------------------------------------------
async function refreshEventosMG({ silent = false } = {}) {
    if (!navigator.onLine) {
        if (!silent) showToast('Offline: mantendo eventos do cache local.', 'info');
        return { updated: false, offline: true };
    }

    if (!silent) showToast('Atualizando eventos de fogo (MG)...', 'info', 2000);

    const [prioridades, eventos] = await Promise.all([
        fetchPrioridadesMG(),
        fetchEventosMG()
    ]);

    // Indexa prioridades por id_evento
    eventosPrioridadesMap.clear();
    if (prioridades) {
        for (const p of prioridades) {
            if (p && p.id_evento != null) eventosPrioridadesMap.set(p.id_evento, p);
        }
        console.log(`[Eventos] ${eventosPrioridadesMap.size} índices de prioridade carregados.`);
    }

    if (!eventos) {
        if (!silent) showToast('Não foi possível atualizar os eventos (rede/CORS).', 'warning', 4000);
        return { updated: false, error: true };
    }

    const geojson = eventosToGeoJSON(eventos);
    await upsertEventosLayer(EVENTOS_LAYER_NAME, geojson, EVENTOS_LAYER_ORDER);

    localStorage.setItem(EVENTOS_STORAGE_KEY, String(Date.now()));
    await reloadLayers();

    console.log(`[Eventos] ${geojson.features.length} eventos em MG.`);

    if (!silent) {
        showToast(
            `Eventos em MG: ${geojson.features.length}` +
            (eventosPrioridadesMap.size ? ` • ${eventosPrioridadesMap.size} com prioridade` : ''),
            'success', 3500
        );
    }
    return { updated: true, total: geojson.features.length };
}

// ---------------------------------------------------------------------------
// Agendamento (2h + eventos de ciclo de vida)
// ---------------------------------------------------------------------------
function eventosCacheIsStale() {
    const last = localStorage.getItem(EVENTOS_STORAGE_KEY);
    if (!last) return true;
    return (Date.now() - parseInt(last, 10)) >= EVENTOS_REFRESH_INTERVAL_MS;
}

async function initEventosMG() {
    const stale = eventosCacheIsStale();
    await refreshEventosMG({ silent: !stale });

    if (eventosRefreshTimer) clearInterval(eventosRefreshTimer);
    eventosRefreshTimer = setInterval(
        () => refreshEventosMG({ silent: false }),
        EVENTOS_REFRESH_INTERVAL_MS
    );

    window.addEventListener('online', () => {
        if (eventosCacheIsStale()) refreshEventosMG({ silent: false });
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && eventosCacheIsStale()) {
            refreshEventosMG({ silent: true });
        }
    });
}

// Expõe para uso manual
window.refreshEventosMG = refreshEventosMG;
window.initEventosMG = initEventosMG;
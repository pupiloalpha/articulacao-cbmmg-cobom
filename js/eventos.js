// js/eventos.js
// Eventos de Fogo (ativos ou em observação) — somente Minas Gerais
// Fonte: Painel do Fogo / CENSIPAM — API OpenAPI v1 + fallbacks
// Estratégia: filtro nativo no servidor (?sigla_estado=MG) + atualização a cada 2h
//
// v18 — Resiliência multi-fonte (proxy 530 + CORS quebrado na API direta):
//   • Cascata: Proxy Worker → WFS GeoServer → API direta (último recurso)
//   • Motivo da ordem: a API direta envia ACAO duplicado ('*, *'), o que
//     o browser bloqueia; o WFS envia um único '*' e funciona no cliente.
//   • Circuit breaker só abre quando TODAS as fontes falham
//   • Lock de execução — evita chamadas concorrentes
//   • NÃO sobrescreve a camada em cache quando o fetch falha
//   • Prioridades: proxy → direto (silencioso se falhar)
//   • WFS: CQL_FILTER=sigla_uf='MG' no servidor; não refiltra por campo
//     quebrado (GeoServer devolve toString de array Java em alguns atributos)

const EVENTOS_PROXY_BASE = 'https://painel-fogo-proxy.pesmesquita.workers.dev';
const EVENTOS_DIRECT_BASE = 'https://panorama.sipam.gov.br/painel-do-fogo/api/v1';
const EVENTOS_WFS_URL =
    'https://panorama.sipam.gov.br/geoserver/painel_do_fogo/wfs';

const EVENTOS_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;  // 2 horas
const EVENTOS_UF = 'MG';
const EVENTOS_LAYER_NAME = 'Eventos de Fogo - MG';
const EVENTOS_LAYER_ORDER = 47;                          // entre Unidades BM e demais camadas
const EVENTOS_STORAGE_KEY = 'eventos_mg_last_fetch';
const EVENTOS_CIRCUIT_KEY = 'eventos_mg_circuit_v2';

// Circuit breaker — só abre após falha de TODAS as fontes
const EVENTOS_CIRCUIT_FAILURE_THRESHOLD = 3;
const EVENTOS_CIRCUIT_OPEN_MS = 10 * 60 * 1000;  // 10 minutos

let eventosRefreshTimer = null;
let eventosPrioridadesMap = new Map();
let _refreshInFlight = null;   // lock de execução

// ---------------------------------------------------------------------------
// Circuit breaker persistente (sobrevive a reload da página)
// ---------------------------------------------------------------------------
function _getCircuit() {
    try {
        const raw = localStorage.getItem(EVENTOS_CIRCUIT_KEY);
        if (!raw) return { failures: 0, openedAt: 0 };
        const parsed = JSON.parse(raw);
        return {
            failures: Number(parsed.failures) || 0,
            openedAt: Number(parsed.openedAt) || 0
        };
    } catch (_) {
        return { failures: 0, openedAt: 0 };
    }
}

function _setCircuit(state) {
    try {
        localStorage.setItem(EVENTOS_CIRCUIT_KEY, JSON.stringify(state));
    } catch (_) {}
}

/**
 * Retorna true se o serviço está em período de "descanso" (circuito aberto).
 * Aplica half-open: após o período, permite UMA tentativa de sondagem.
 */
function _isCircuitOpen() {
    const state = _getCircuit();
    if (state.failures < EVENTOS_CIRCUIT_FAILURE_THRESHOLD) return false;

    const elapsed = Date.now() - state.openedAt;
    if (elapsed >= EVENTOS_CIRCUIT_OPEN_MS) {
        _setCircuit({ failures: EVENTOS_CIRCUIT_FAILURE_THRESHOLD - 1, openedAt: 0 });
        return false;
    }
    return true;
}

function _recordCircuitFailure() {
    const state = _getCircuit();
    state.failures = (state.failures || 0) + 1;
    if (state.failures >= EVENTOS_CIRCUIT_FAILURE_THRESHOLD) {
        state.openedAt = Date.now();
    }
    _setCircuit(state);
}

function _recordCircuitSuccess() {
    _setCircuit({ failures: 0, openedAt: 0 });
}

// ---------------------------------------------------------------------------
// Conversão: EventSchema[] → FeatureCollection
// ---------------------------------------------------------------------------
function eventosToGeoJSON(eventos) {
    if (!Array.isArray(eventos)) return { type: 'FeatureCollection', features: [] };

    const features = [];
    for (const ev of eventos) {
        const geom = ev.geom;
        if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;

        const cleanGeom = { type: geom.type, coordinates: geom.coordinates };

        const { geom: _g, retangulo_envolvente: _r, ...rest } = ev;

        const props = { ...rest, _tipo: 'EVENTO_FOGO', _uf: EVENTOS_UF };

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

/**
 * Limpa valores que o GeoServer devolve como toString de array Java
 * (ex.: "[Ljava.lang.String;@1a2b3c4") ou Arrays.toString ("[MG]").
 */
function _cleanWfsScalar(val) {
    if (val == null) return null;
    const s = String(val).trim();
    if (!s) return null;
    // Java Object[] toString
    if (/^\[L[a-zA-Z0-9.]+;@/.test(s)) return null;
    // Arrays.toString → "[MG]" / "[Foo, Bar]"
    if (s.startsWith('[') && s.endsWith(']')) {
        const inner = s.slice(1, -1).trim();
        if (!inner) return null;
        return inner.split(',')[0].trim() || null;
    }
    return s;
}

/**
 * Converte FeatureCollection WFS (mv_evento_filtro) → array no formato da API.
 * O CQL_FILTER já restringiu a UF no servidor — não refiltramos por sigla_uf
 * (campo frequentemente corrompido no WFS).
 */
function wfsFeaturesToEventos(fc) {
    if (!fc || !Array.isArray(fc.features)) return [];

    const out = [];
    for (const f of fc.features) {
        const p = f.properties || {};
        const geom = f.geometry;
        if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;

        const id = p.id_evento != null ? p.id_evento : p.id;
        if (id == null) continue;

        const municipio = _cleanWfsScalar(p.nome_municipio) ||
                          _cleanWfsScalar(p.municipio) || null;

        let status = _cleanWfsScalar(p.status_visita);
        if (!status && p.id_status_evento != null) {
            status = String(p.id_status_evento);
        }
        if (!status) status = 'Em observação';

        out.push({
            id_evento: id,
            status_evento: status,
            dt_minima: p.dt_minima || null,
            dt_maxima: p.dt_maxima || null,
            persistencia_dias: p.persistencia_dias,
            area_total_evento: p.area_total_evento,
            municipio: municipio,
            pais: _cleanWfsScalar(p.cod_pais) || 'BRA',
            terra_indigena: _cleanWfsScalar(p.nome_terra_indigena) || null,
            unidade_conservacao: _cleanWfsScalar(p.nome_unidade_conservacao) || null,
            quilombola: _cleanWfsScalar(p.nome_quilombola) || null,
            projeto_assentamento: _cleanWfsScalar(p.projeto_assentamento) || null,
            prioridade_evento: p.prioridade_evento,
            qtd_deteccoes: p.qtd_deteccoes,
            geom: { type: geom.type, coordinates: geom.coordinates },
            _fonte: 'wfs'
        });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Fetch genérico com timeout + classificação de 5xx / CORS
// ---------------------------------------------------------------------------
async function _fetchJson(url, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            method: 'GET',
            mode: 'cors',
            headers: { 'Accept': 'application/json' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.status >= 500) {
            return { ok: false, status: res.status, unavailable: true };
        }
        if (!res.ok) {
            return { ok: false, status: res.status };
        }

        const data = await res.json();
        return { ok: true, data };
    } catch (e) {
        clearTimeout(timeoutId);
        const isAbort = e && e.name === 'AbortError';
        return { ok: false, error: e, timeout: isAbort, network: !isAbort };
    }
}

// ---------------------------------------------------------------------------
// Fetch dos endpoints — cascata multi-fonte
// ---------------------------------------------------------------------------

/**
 * Busca os eventos ativos em MG.
 * Cascata (ordem importa — ver comentário do cabeçalho):
 *   1) Proxy Cloudflare Worker
 *   2) WFS GeoServer (CORS válido, filtro CQL no servidor)
 *   3) API direta CENSIPAM (último: CORS com ACAO duplicado no browser)
 */
async function fetchEventosMG() {
    const profile = (typeof getNetworkProfile === 'function')
        ? getNetworkProfile()
        : { eventosTimeout: 22000 };

    const timeout = Math.max(profile.eventosTimeout || 22000, 20000);

    // ---- 1) Proxy ----
    {
        const url = `${EVENTOS_PROXY_BASE}/eventos?sigla_estado=${EVENTOS_UF}`;
        const result = await _fetchJson(url, timeout);
        if (result.ok && Array.isArray(result.data)) {
            console.log(`[Eventos] Fonte: proxy (${result.data.length} registros).`);
            return { ok: true, data: result.data, source: 'proxy' };
        }
        if (result.unavailable || result.status >= 500) {
            console.warn(`[Eventos] Proxy indisponível (HTTP ${result.status || '—'}). Tentando WFS...`);
        } else if (result.timeout) {
            console.warn('[Eventos] Timeout no proxy. Tentando WFS...');
        } else {
            console.warn(`[Eventos] Proxy falhou (HTTP ${result.status || 'rede'}). Tentando WFS...`);
        }
    }

    // ---- 2) WFS GeoServer (CORS ok no browser) ----
    {
        const params = new URLSearchParams({
            service: 'WFS',
            version: '1.0.0',
            request: 'GetFeature',
            typeName: 'painel_do_fogo:mv_evento_filtro',
            outputFormat: 'application/json',
            CQL_FILTER: `sigla_uf='${EVENTOS_UF}'`
        });
        const url = `${EVENTOS_WFS_URL}?${params.toString()}`;
        const result = await _fetchJson(url, timeout + 10000);
        if (result.ok && result.data) {
            const eventos = wfsFeaturesToEventos(result.data);
            if (eventos.length > 0) {
                console.log(`[Eventos] Fonte: WFS (${eventos.length} registros).`);
                return { ok: true, data: eventos, source: 'wfs' };
            }
            console.warn('[Eventos] WFS respondeu, mas nenhuma feição utilizável após normalização.');
        } else if (result.timeout) {
            console.warn('[Eventos] Timeout no WFS. Tentando API direta...');
        } else if (result.network) {
            console.warn('[Eventos] WFS bloqueado por rede/CORS. Tentando API direta...');
        } else {
            console.warn(`[Eventos] WFS falhou (HTTP ${result.status || '—'}). Tentando API direta...`);
        }
    }

    // ---- 3) API direta (último recurso — ACAO duplicado pode falhar no browser) ----
    {
        const url = `${EVENTOS_DIRECT_BASE}/eventos?sigla_estado=${EVENTOS_UF}`;
        const result = await _fetchJson(url, timeout + 5000);
        if (result.ok && Array.isArray(result.data)) {
            console.log(`[Eventos] Fonte: API direta (${result.data.length} registros).`);
            return { ok: true, data: result.data, source: 'direct' };
        }
        if (result.network) {
            console.warn('[Eventos] API direta bloqueada por CORS/rede.');
        } else if (result.timeout) {
            console.warn('[Eventos] Timeout na API direta.');
        } else {
            console.warn(`[Eventos] API direta falhou (HTTP ${result.status || '—'}).`);
        }
    }

    return { ok: false, error: true };
}

/**
 * Busca os índices de prioridade dos eventos para MG.
 * Cascata: proxy → API direta. Enriquecimento OPCIONAL.
 */
async function fetchPrioridadesMG() {
    const profile = (typeof getNetworkProfile === 'function')
        ? getNetworkProfile()
        : { eventosTimeout: 15000 };

    const prioridadesTimeout = Math.min(8000, Math.max(4000, profile.eventosTimeout || 15000));

    const urls = [
        `${EVENTOS_PROXY_BASE}/eventos/prioridades?sigla_estado=${EVENTOS_UF}`,
        `${EVENTOS_DIRECT_BASE}/eventos/prioridades?sigla_estado=${EVENTOS_UF}`
    ];

    for (const url of urls) {
        const result = await _fetchJson(url, prioridadesTimeout);
        if (result.ok && Array.isArray(result.data)) {
            return result.data;
        }
    }
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
// Refresh principal (com lock + circuit breaker)
// ---------------------------------------------------------------------------
async function _doRefreshEventosMG({ silent = false } = {}) {
    if (!navigator.onLine) {
        if (!silent) showToast('Offline: mantendo eventos do cache local.', 'info');
        return { updated: false, offline: true };
    }

    if (_isCircuitOpen()) {
        if (!silent) {
            showToast('Serviço de eventos temporariamente indisponível.', 'info', 3000);
        }
        return { updated: false, circuitOpen: true };
    }

    if (!silent) showToast('Atualizando eventos de fogo (MG)...', 'info', 2000);

    const eventosResult = await fetchEventosMG();

    if (!eventosResult.ok) {
        _recordCircuitFailure();

        if (!silent) {
            showToast('Não foi possível atualizar os eventos. Mantendo cache local.', 'warning', 4000);
        }
        return { updated: false, error: true };
    }

    _recordCircuitSuccess();

    const prioridades = await fetchPrioridadesMG();

    eventosPrioridadesMap.clear();
    if (prioridades) {
        for (const p of prioridades) {
            if (p && p.id_evento != null) eventosPrioridadesMap.set(p.id_evento, p);
        }
        if (eventosPrioridadesMap.size > 0) {
            console.log(`[Eventos] ${eventosPrioridadesMap.size} índices de prioridade carregados.`);
        }
    }

    const geojson = eventosToGeoJSON(eventosResult.data);
    await upsertEventosLayer(EVENTOS_LAYER_NAME, geojson, EVENTOS_LAYER_ORDER);

    localStorage.setItem(EVENTOS_STORAGE_KEY, String(Date.now()));
    await reloadLayers();

    const srcLabel = eventosResult.source === 'proxy' ? ''
        : eventosResult.source === 'wfs' ? ' (WFS)'
        : eventosResult.source === 'direct' ? ' (API direta)'
        : '';

    console.log(`[Eventos] ${geojson.features.length} eventos em MG${srcLabel}.`);

    if (!silent) {
        showToast(
            `Eventos em MG: ${geojson.features.length}` +
            (eventosPrioridadesMap.size ? ` • ${eventosPrioridadesMap.size} com prioridade` : '') +
            srcLabel,
            'success', 3500
        );
    }
    return { updated: true, total: geojson.features.length, source: eventosResult.source };
}

/**
 * Wrapper com lock — garante que apenas UMA execução ocorra por vez.
 */
async function refreshEventosMG(opts = {}) {
    if (_refreshInFlight) return _refreshInFlight;

    _refreshInFlight = _doRefreshEventosMG(opts);
    try {
        return await _refreshInFlight;
    } finally {
        _refreshInFlight = null;
    }
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
    // Limpa circuit legado e reseta o atual para permitir nova sondagem
    // após upgrade (proxy 530 não deve manter o app bloqueado).
    try {
        localStorage.removeItem('eventos_mg_circuit_v1');
        localStorage.removeItem(EVENTOS_CIRCUIT_KEY);
    } catch (_) {}

    const stale = eventosCacheIsStale();
    await refreshEventosMG({ silent: !stale });

    if (eventosRefreshTimer) clearInterval(eventosRefreshTimer);
    eventosRefreshTimer = setInterval(
        () => refreshEventosMG({ silent: false }),
        EVENTOS_REFRESH_INTERVAL_MS
    );

    window.addEventListener('online', () => {
        if (eventosCacheIsStale() && !_isCircuitOpen()) {
            refreshEventosMG({ silent: false });
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && eventosCacheIsStale() && !_isCircuitOpen()) {
            refreshEventosMG({ silent: true });
        }
    });
}

// Expõe para uso manual
window.refreshEventosMG = refreshEventosMG;
window.initEventosMG = initEventosMG;

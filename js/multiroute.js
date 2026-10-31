// js/multiroute.js - Rota com vários pontos (origem, paradas e destino)
// ===========================================================================
// Autor: Jeferson Manini — atualização v16 (30/10/2026)
// ---------------------------------------------------------------------------
// Funciona como o "Rotas" do Google Maps:
//   • 2 a 10 pontos (A, B, C...), cada um definido por busca de endereço,
//     coordenada colada, clique no mapa, clique numa feição ou GPS
//   • Reordenar (↑/↓), inverter, remover, arrastar o pino no mapa
//   • Rota real pelas vias (OSRM, uma única requisição com todos os pontos)
//   • Sem internet: rota aproximada pela malha local de logradouros por
//     trecho e, se não houver malha, linha reta
//   • Resumo com total e cada trecho; atalhos para Google Maps e cópia
//
// Depende de: Leaflet, turf, utils.js (svgIcon, escapeHtml, showToast),
// search.js (searchAddress, registerSearchSelectHandler), map.js
// (findApproxOfflineRoute) e app.js (map, enterRouteViewMode...).
// ===========================================================================

const MR_MAX_STOPS = 10;
const MR_SEARCH_DEBOUNCE_MS = 450;
const MR_OSRM_CACHE_MAX = 30;

const MR_COLORS = {
    road: '#1a73e8',      // rota por vias (OSRM)
    approx: '#1a5276',    // rota aproximada pela malha local
    straight: '#e74c3c'   // linha reta (sem malha)
};

let _mrStops = [];
let _mrSeq = 0;
let _mrOpen = false;
let _mrLayer = null;
let _mrPickingId = null;
let _mrCalcToken = 0;
let _mrCalcTimer = null;
let _mrEnteredRouteView = false;
let _mrMapHooked = false;
let _mrLastResult = null;
let _mrRegisteredTargets = new Set();
const _mrSearchTimers = new Map();
const _mrOsrmCache = new Map();
// Cache de POIs por parada (chave: "lat,lng" com 5 casas decimais)
const _mrPoiCache = new Map();
// Token de geração da análise de POIs — invalida execuções obsoletas
let _mrPoiAnalysisToken = 0;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function _mrNewStop() {
    return { id: ++_mrSeq, lat: null, lng: null, label: '', address: '' };
}

function _mrLetter(index) {
    return String.fromCharCode(65 + index);
}

function _mrIsResolved(stop) {
    return stop && Number.isFinite(stop.lat) && Number.isFinite(stop.lng);
}

function _mrResolvedStops() {
    return _mrStops.filter(_mrIsResolved);
}

function _mrFmtDist(meters) {
    if (!Number.isFinite(meters)) return '—';
    if (meters < 1000) return `${Math.round(meters)} m`;
    const km = meters / 1000;
    return `${km.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: km < 100 ? 1 : 0 })} km`;
}

function _mrFmtTime(seconds) {
    if (!Number.isFinite(seconds)) return '';
    const totalMin = Math.max(1, Math.round(seconds / 60));
    if (totalMin < 60) return `${totalMin} min`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}

function _mrCoordLabel(lat, lng) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function _mrPlaceholder(index, total) {
    if (index === 0) return 'Ponto de partida';
    if (index === total - 1) return 'Destino';
    return 'Parada';
}

function _mrRole(index, total) {
    if (index === 0) return 'origin';
    if (index === total - 1) return 'dest';
    return 'mid';
}

function _mrIsMobile() {
    return typeof isMobileViewport === 'function'
        ? isMobileViewport()
        : window.matchMedia('(max-width: 768px)').matches;
}

function _mrFindStop(id) {
    return _mrStops.find(s => s.id === id) || null;
}

function _mrInputFor(id) {
    return document.querySelector(`#mrStopsList .mr-stop[data-id="${id}"] .mr-input`);
}

function _mrResultsId(id) {
    return `mrResults_${id}`;
}

// ---------------------------------------------------------------------------
// Abrir / fechar painel
// ---------------------------------------------------------------------------
function openMultiRoute(options = {}) {
    const panel = document.getElementById('multiRoutePanel');
    const toggleBtn = document.getElementById('multiRouteBtn');
    if (!panel) return;

    // Garante a sidebar visível (atalho Alt+R com painel fechado)
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('collapsed') && typeof _openSidebar === 'function') {
        _openSidebar();
    }

    if (!_mrOpen) {
        _mrOpen = true;
        if (_mrStops.length < 2) _mrStops = [_mrNewStop(), _mrNewStop()];

        // Pré-preenche o ponto A com o local já pesquisado (origem atual)
        const origin = window.currentSearchResult;
        const first = _mrStops[0];
        if (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng) && !_mrIsResolved(first)) {
            first.lat = origin.lat;
            first.lng = origin.lng;
            first.label = origin.address || _mrCoordLabel(origin.lat, origin.lng);
            first.address = first.label;
        }

        panel.classList.remove('hidden');
        if (toggleBtn) {
            toggleBtn.classList.add('active');
            toggleBtn.setAttribute('aria-expanded', 'true');
        }
        _mrRenderStops();
        _mrScheduleCompute(0);
    }

    if (options.focus !== false) _mrFocusFirstEmpty();
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * Fecha o painel e remove a rota do mapa.
 * @param {object}  [options]
 * @param {boolean} [options.restoreView=true]  false quando o chamador (ex.:
 *                  resetAll) já vai restaurar a visualização das camadas.
 * @param {boolean} [options.silent=false]
 */
function closeMultiRoute(options = {}) {
    const { restoreView = true, silent = false } = options;
    const panel = document.getElementById('multiRoutePanel');
    const toggleBtn = document.getElementById('multiRouteBtn');

    const hadRoute = !!_mrLayer;

    _mrCancelPick(true);
    _mrCalcToken++;
    clearTimeout(_mrCalcTimer);
    _mrSearchTimers.forEach(t => clearTimeout(t));
    _mrSearchTimers.clear();
    _mrClearMapLayers();
    _mrUnregisterAllTargets();

    _mrStops = [];
    _mrLastResult = null;
    _mrPoiCache.clear();
    _mrClearPoiPanel();
    _mrOpen = false;

    if (panel) panel.classList.add('hidden');
    const list = document.getElementById('mrStopsList');
    if (list) list.innerHTML = '';
    const summary = document.getElementById('mrSummary');
    if (summary) summary.innerHTML = '';

    if (toggleBtn) {
        toggleBtn.classList.remove('active');
        toggleBtn.setAttribute('aria-expanded', 'false');
    }

    if (_mrEnteredRouteView) {
        _mrEnteredRouteView = false;
        if (restoreView && typeof window.exitRouteViewMode === 'function') {
            window.exitRouteViewMode();
        }
    }

    if (!silent && hadRoute) showToast('Rota com vários pontos encerrada.', 'info', 2000);
}

function toggleMultiRoute() {
    if (_mrOpen) closeMultiRoute();
    else openMultiRoute();
}

function _mrFocusFirstEmpty() {
    const target = _mrStops.find(s => !_mrIsResolved(s)) || null;
    if (!target) return;
    setTimeout(() => {
        const input = _mrInputFor(target.id);
        if (input) input.focus();
    }, 30);
}

// ---------------------------------------------------------------------------
// Renderização da lista de pontos
// ---------------------------------------------------------------------------
function _mrUnregisterAllTargets() {
    if (typeof window.unregisterSearchSelectHandler === 'function') {
        _mrRegisteredTargets.forEach(t => window.unregisterSearchSelectHandler(t));
    }
    _mrRegisteredTargets.clear();
}

function _mrRenderStops(focusId = null) {
    const list = document.getElementById('mrStopsList');
    if (!list) return;

    _mrUnregisterAllTargets();
    list.innerHTML = '';

    const total = _mrStops.length;

    _mrStops.forEach((stop, index) => {
        const role = _mrRole(index, total);
        const letter = _mrLetter(index);

        const wrap = document.createElement('div');
        wrap.className = 'mr-stop';
        wrap.dataset.id = String(stop.id);

        const row = document.createElement('div');
        row.className = 'mr-stop-row';

        const badge = document.createElement('span');
        badge.className = `mr-badge mr-badge--${role}`;
        badge.textContent = letter;
        badge.setAttribute('aria-hidden', 'true');

        const order = document.createElement('div');
        order.className = 'mr-order';
        order.innerHTML = `
            <button type="button" class="mr-order-btn" data-mr="up" title="Mover para cima" aria-label="Mover ponto ${letter} para cima" ${index === 0 ? 'disabled' : ''}>${svgIcon('chevron-up', 12)}</button>
            <button type="button" class="mr-order-btn" data-mr="down" title="Mover para baixo" aria-label="Mover ponto ${letter} para baixo" ${index === total - 1 ? 'disabled' : ''}>${svgIcon('chevron-down', 12)}</button>`;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'mr-input' + (_mrIsResolved(stop) ? ' is-resolved' : '');
        // [v17 – Jeferson Manini] texto curto: não fica cortado no campo
        input.placeholder = _mrPlaceholder(index, total);
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.value = stop.label || '';
        input.title = stop.address || stop.label || '';
        input.setAttribute('aria-label', `Ponto ${letter}: ${_mrPlaceholder(index, total)}`);
        input.setAttribute('aria-controls', _mrResultsId(stop.id));

        const pickBtn = document.createElement('button');
        pickBtn.type = 'button';
        pickBtn.className = 'mr-icon-btn' + (_mrPickingId === stop.id ? ' is-active' : '');
        pickBtn.dataset.mr = 'pick';
        pickBtn.title = 'Marcar no mapa';
        pickBtn.setAttribute('aria-label', `Marcar ponto ${letter} no mapa`);
        pickBtn.innerHTML = svgIcon('target', 15);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'mr-icon-btn';
        removeBtn.dataset.mr = 'remove';
        const canRemove = total > 2;
        removeBtn.title = canRemove ? 'Remover ponto' : 'Limpar campo';
        removeBtn.setAttribute('aria-label', canRemove ? `Remover ponto ${letter}` : `Limpar ponto ${letter}`);
        removeBtn.innerHTML = svgIcon('x', 15);

        row.append(order, badge, input, pickBtn, removeBtn);

        const results = document.createElement('div');
        results.className = 'mr-results';
        results.id = _mrResultsId(stop.id);

        wrap.append(row, results);
        list.appendChild(wrap);

        _mrBindInput(stop.id, input, results);
    });

    const addBtn = document.getElementById('mrAddStopBtn');
    if (addBtn) addBtn.disabled = total >= MR_MAX_STOPS;

    if (focusId !== null) {
        const input = _mrInputFor(focusId);
        if (input) input.focus();
    }
}

// ---------------------------------------------------------------------------
// Campo de busca de cada ponto
// ---------------------------------------------------------------------------
function _mrBindInput(stopId, input, results) {
    const targetId = results.id;

    if (typeof window.registerSearchSelectHandler === 'function') {
        window.registerSearchSelectHandler(targetId, {
            inputEl: input,
            onSelect: (result) => _mrApplySearchResult(stopId, result)
        });
        _mrRegisteredTargets.add(targetId);
    }

    // Clicar nos resultados não deve tirar o foco do campo (evita fechar
    // a lista antes do clique ser processado — inclusive em toque).
    results.addEventListener('mousedown', e => e.preventDefault());

    input.addEventListener('focus', () => {
        results.removeAttribute('data-closed');
        if (!input.value.trim()) _mrShowQuickOptions(stopId, results);
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            if (document.activeElement === input) return;
            _mrCloseResults(results);
            // Texto editado sem escolher resultado → volta ao rótulo válido
            const stop = _mrFindStop(stopId);
            if (stop && _mrIsResolved(stop) && input.value !== stop.label) {
                input.value = stop.label;
            }
        }, 150);
    });

    input.addEventListener('input', () => {
        results.removeAttribute('data-closed');
        clearTimeout(_mrSearchTimers.get(stopId));
        const query = input.value.trim();

        if (!query) {
            _mrShowQuickOptions(stopId, results);
            return;
        }

        const looksLikeCoords = typeof tryParseCoordinates === 'function' && !!tryParseCoordinates(query);
        if (query.length < 3 && !looksLikeCoords) {
            results.innerHTML = '';
            return;
        }

        _mrSearchTimers.set(stopId, setTimeout(() => {
            if (typeof searchAddress === 'function') searchAddress(query, targetId);
        }, MR_SEARCH_DEBOUNCE_MS));
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const items = _mrResultItems(results);
            if (!items.length) return;
            e.preventDefault();
            let idx = items.findIndex(el => el.classList.contains('mr-kb-active'));
            items.forEach(el => el.classList.remove('mr-kb-active'));
            idx = e.key === 'ArrowDown'
                ? (idx + 1) % items.length
                : (idx <= 0 ? items.length - 1 : idx - 1);
            items[idx].classList.add('mr-kb-active');
            items[idx].scrollIntoView({ block: 'nearest' });
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            const items = _mrResultItems(results);
            const active = items.find(el => el.classList.contains('mr-kb-active'));
            const resultItems = items.filter(el => el.classList.contains('search-result-item'));
            const callItems = items.filter(el => el.classList.contains('cad-call-pick'));
            const target = active || resultItems[0] || callItems[0];
            if (target && !results.hasAttribute('data-closed')) {
                target.click();
                return;
            }
            // Sem resultados ainda → busca imediata
            clearTimeout(_mrSearchTimers.get(stopId));
            const query = input.value.trim();
            if (query && typeof searchAddress === 'function') searchAddress(query, targetId);
            return;
        }

        if (e.key === 'Escape') {
            // Não deixa o Esc global limpar o mapa enquanto se edita o campo
            e.stopPropagation();
            const stop = _mrFindStop(stopId);
            const hasOpenList = results.innerHTML.trim() && !results.hasAttribute('data-closed');
            if (hasOpenList) {
                _mrCloseResults(results);
            } else if (stop && _mrIsResolved(stop) && input.value !== stop.label) {
                input.value = stop.label;
            } else {
                input.blur();
            }
        }
    });
}

function _mrResultItems(results) {
    if (results.hasAttribute('data-closed')) return [];
    return Array.from(results.querySelectorAll('.search-result-item, .mr-quick-item, .search-suggestion, .cad-call-pick'));
}

function _mrCloseResults(results) {
    if (!results) return;
    results.setAttribute('data-closed', '1');
    results.innerHTML = '';
}

/**
 * Opções rápidas para campo vazio: GPS e local já pesquisado.
 */
function _mrShowQuickOptions(stopId, results) {
    results.innerHTML = '';

    const options = [];
    if ('geolocation' in navigator) {
        options.push({
            icon: 'crosshair',
            title: 'Minha localização (GPS)',
            sub: 'Usa a posição atual do dispositivo',
            run: () => _mrUseGps(stopId)
        });
    }

    const origin = window.currentSearchResult;
    if (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)) {
        const label = origin.address || _mrCoordLabel(origin.lat, origin.lng);
        options.push({
            icon: 'pin',
            title: 'Local pesquisado',
            sub: label,
            run: () => _mrSetStop(stopId, { lat: origin.lat, lng: origin.lng, label, address: label })
        });
    }

    options.push({
        icon: 'target',
        title: 'Marcar no mapa',
        sub: 'Clique no mapa ou numa feição (unidade, hospital...)',
        run: () => _mrStartPick(stopId)
    });

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mr-quick-item';
        btn.innerHTML = `
            <span class="mr-quick-icon">${svgIcon(opt.icon, 14)}</span>
            <span class="mr-quick-text">
                <span class="mr-quick-title">${escapeHtml(opt.title)}</span>
                <span class="mr-quick-sub">${escapeHtml(opt.sub)}</span>
            </span>`;
        btn.addEventListener('click', () => {
            _mrCloseResults(results);
            opt.run();
        });
        results.appendChild(btn);
    });
}

function _mrApplySearchResult(stopId, result) {
    if (!result || !Number.isFinite(result.lat) || !Number.isFinite(result.lng)) return;

    // [v17 – Jeferson Manini] Ponto vindo de uma chamada do SIDS: usa o
    // endereço do CAD como rótulo e guarda o protocolo
    if (result.cadCall) {
        const call = result.cadCall;
        const cad = typeof parseCadAddress === 'function' ? parseCadAddress(call.address) : null;
        const label = cad
            ? `${cad.street}${cad.number ? `, ${cad.number}` : ''}${(cad.cityName || cad.city) ? ` – ${cad.cityName || cad.city}` : ''}`
            : call.address;
        _mrSetStop(stopId, {
            lat: result.lat,
            lng: result.lng,
            label,
            address: `${call.address}${call.protocol ? ` · Chamada ${call.protocol}` : ''}${call.nature ? ` · ${call.nature}` : ''}`
        });
        return;
    }

    let label = result.title || result.address || _mrCoordLabel(result.lat, result.lng);
    const mun = result.munBadge;
    if (mun && mun !== 'Online (OSM)' && (result.source === 'online_osm' || result.source === 'offline_ruas')) {
        if (!normalizeStr(label).includes(normalizeStr(mun))) label = `${label} – ${mun}`;
    }

    _mrSetStop(stopId, {
        lat: result.lat,
        lng: result.lng,
        label,
        address: result.address || label
    });
}

// ---------------------------------------------------------------------------
// Alterações nos pontos
// ---------------------------------------------------------------------------
function _mrSetStop(stopId, data, options = {}) {
    const { advanceFocus = true, reverseGeocode = false } = options;
    const stop = _mrFindStop(stopId);
    if (!stop) return;

    // Invalida o cache de POIs da posição ANTIGA (o pino mudou de lugar)
    if (stop.lat != null && stop.lng != null) {
        _mrPoiCache.delete(`${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`);
    }

    stop.lat = data.lat;
    stop.lng = data.lng;
    stop.label = data.label;
    stop.address = data.address || data.label;

    // A rota mudou: painel de POIs fica obsoleto
    _mrClearPoiPanel();

    const input = _mrInputFor(stopId);
    if (input) {
        input.value = stop.label;
        input.title = stop.address;
        input.classList.add('is-resolved');
    }
    const results = document.getElementById(_mrResultsId(stopId));
    _mrCloseResults(results);

    if (reverseGeocode) _mrReverseGeocodeStop(stopId);

    _mrScheduleCompute(0, { fromUser: true });

    if (advanceFocus) {
        const next = _mrStops.find(s => !_mrIsResolved(s));
        if (next) {
            const nextInput = _mrInputFor(next.id);
            if (nextInput) setTimeout(() => nextInput.focus(), 30);
        } else if (input) {
            input.blur();
        }
    }
}

function _mrClearStop(stopId) {
    const stop = _mrFindStop(stopId);
    if (!stop) return;
    if (stop.lat != null && stop.lng != null) {
        _mrPoiCache.delete(`${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`);
    }
    stop.lat = null;
    stop.lng = null;
    stop.label = '';
    stop.address = '';
    _mrClearPoiPanel();
    _mrRenderStops(stopId);
    _mrScheduleCompute(0);
}

function addMultiRouteStop() {
    if (!_mrOpen) openMultiRoute({ focus: false });
    if (_mrStops.length >= MR_MAX_STOPS) {
        showToast(`Limite de ${MR_MAX_STOPS} pontos por rota.`, 'warning', 3000);
        return null;
    }
    const stop = _mrNewStop();
    _mrStops.push(stop);
    _mrRenderStops(stop.id);
    _mrScheduleCompute(0);
    return stop;
}

function _mrRemoveStop(stopId) {
    if (_mrStops.length <= 2) {
        _mrClearStop(stopId);
        return;
    }
    if (_mrPickingId === stopId) _mrCancelPick(true);

    // Invalida cache de POI da posição removida
    const stop = _mrFindStop(stopId);
    if (stop && stop.lat != null && stop.lng != null) {
        _mrPoiCache.delete(`${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`);
    }

    _mrStops = _mrStops.filter(s => s.id !== stopId);
    _mrClearPoiPanel();
    _mrRenderStops();
    _mrScheduleCompute(0);
}

function _mrMoveStop(stopId, delta) {
    const idx = _mrStops.findIndex(s => s.id === stopId);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= _mrStops.length) return;
    const [stop] = _mrStops.splice(idx, 1);
    _mrStops.splice(to, 0, stop);
    _mrClearPoiPanel();
    _mrRenderStops();
    const btn = document.querySelector(`#mrStopsList .mr-stop[data-id="${stopId}"] [data-mr="${delta < 0 ? 'up' : 'down'}"]`);
    if (btn && !btn.disabled) btn.focus();
    _mrScheduleCompute(0);
}

function _mrReverseStops() {
    if (_mrStops.length < 2) return;
    _mrStops.reverse();
    _mrClearPoiPanel();
    _mrRenderStops();
    _mrScheduleCompute(0);
}

// ---------------------------------------------------------------------------
// GPS
// ---------------------------------------------------------------------------
function _mrUseGps(stopId) {
    if (!('geolocation' in navigator)) {
        showToast('GPS indisponível neste dispositivo.', 'warning');
        return;
    }
    const input = _mrInputFor(stopId);
    if (input) input.value = 'Obtendo localização...';

    navigator.geolocation.getCurrentPosition(
        pos => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const label = 'Minha localização (GPS)';
            _mrSetStop(stopId, { lat, lng, label, address: `${label} – ${_mrCoordLabel(lat, lng)}` });
        },
        () => {
            const stop = _mrFindStop(stopId);
            if (input) input.value = stop ? stop.label : '';
            showToast('Não foi possível obter a localização GPS.', 'warning', 3500);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
}

// ---------------------------------------------------------------------------
// Marcar no mapa (clique no mapa ou numa feição)
// ---------------------------------------------------------------------------
function _mrEnsureMapHooks() {
    if (_mrMapHooked || typeof map === 'undefined' || !map) return;
    _mrMapHooked = true;
    map.on('click', e => {
        if (_mrPickingId === null) return;
        _mrFinishPick(e.latlng.lat, e.latlng.lng, null);
    });
}

function _mrStartPick(stopId) {
    _mrEnsureMapHooks();
    if (typeof map === 'undefined' || !map) return;

    // Sai do modo "Ponto no Mapa" da origem principal, se estiver ativo
    if (typeof mapClickMode !== 'undefined' && mapClickMode && typeof window.exitMapOriginMode === 'function') {
        window.exitMapOriginMode(true);
    }

    _mrPickingId = stopId;
    map.getContainer().style.cursor = 'crosshair';
    document.body.classList.add('mr-picking');

    document.querySelectorAll('#mrStopsList [data-mr="pick"]').forEach(btn => {
        const id = Number(btn.closest('.mr-stop')?.dataset.id);
        btn.classList.toggle('is-active', id === stopId);
    });

    const idx = _mrStops.findIndex(s => s.id === stopId);
    const letter = idx >= 0 ? _mrLetter(idx) : '';

    if (_mrIsMobile() && typeof _closeSidebar === 'function') _closeSidebar();

    showToast(`Clique no mapa ou numa feição para definir o ponto ${letter}. Esc cancela.`, 'info', 4000);
}

function _mrCancelPick(silent = false) {
    if (_mrPickingId === null) return false;
    _mrPickingId = null;
    if (typeof map !== 'undefined' && map) map.getContainer().style.cursor = '';
    document.body.classList.remove('mr-picking');
    document.querySelectorAll('#mrStopsList [data-mr="pick"].is-active')
        .forEach(btn => btn.classList.remove('is-active'));
    if (!silent) showToast('Marcação cancelada.', 'info', 1800);
    return true;
}

function _mrFinishPick(lat, lng, featureName) {
    const stopId = _mrPickingId;
    _mrCancelPick(true);
    if (stopId === null || !_mrFindStop(stopId)) return;

    const label = featureName || `Ponto no mapa (${_mrCoordLabel(lat, lng)})`;
    _mrSetStop(stopId, { lat, lng, label, address: label }, {
        advanceFocus: !_mrIsMobile(),
        reverseGeocode: !featureName
    });

    // Em mobile, reabre o painel se ainda faltar algum ponto
    if (_mrIsMobile() && _mrStops.some(s => !_mrIsResolved(s)) && typeof _openSidebar === 'function') {
        setTimeout(() => _openSidebar(), 250);
    }
}

/**
 * Chamado por layers.js quando uma feição é clicada durante a marcação.
 * Usa a posição da feição (pontos) ou do clique (polígonos).
 */
function _mrPickFromFeature(e, feature) {
    let lat = e?.latlng?.lat;
    let lng = e?.latlng?.lng;
    let name = null;

    if (feature?.geometry?.type === 'Point') {
        const [fLng, fLat] = feature.geometry.coordinates;
        lat = fLat;
        lng = fLng;
        name = (typeof getFeatureDisplayName === 'function')
            ? getFeatureDisplayName(feature)
            : (feature.properties?.name || null);
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    _mrFinishPick(lat, lng, name || null);
    setTimeout(() => { if (map) map.closePopup(); }, 0);
}

async function _mrReverseGeocodeStop(stopId) {
    if (!navigator.onLine) return;
    const stop = _mrFindStop(stopId);
    if (!stop || !_mrIsResolved(stop)) return;
    const { lat, lng } = stop;

    const profile = (typeof getNetworkProfile === 'function')
        ? getNetworkProfile() : { reverseGeocodeTimeout: 3500 };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), profile.reverseGeocodeTimeout || 3500);

    try {
        const params = new URLSearchParams({
            format: 'json', lat: String(lat), lon: String(lng),
            zoom: '18', addressdetails: '1', 'accept-language': 'pt'
        });
        const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
            headers: { 'Accept': 'application/json' },
            signal: controller.signal
        });
        clearTimeout(timer);
        if (!resp.ok) return;
        const data = await resp.json();
        const a = data?.address || {};
        const road = a.road || a.pedestrian || a.footway || a.neighbourhood || a.suburb || '';
        if (!road) return;
        const city = a.city || a.town || a.village || a.municipality || '';
        let label = road;
        if (a.house_number) label += `, ${a.house_number}`;
        if (city) label += ` – ${city}`;

        // Só aplica se o ponto não mudou enquanto aguardava a resposta
        const current = _mrFindStop(stopId);
        if (!current || current.lat !== lat || current.lng !== lng) return;
        current.label = label;
        current.address = data.display_name || label;
        const input = _mrInputFor(stopId);
        if (input && document.activeElement !== input) {
            input.value = label;
            input.title = current.address;
        }
        _mrUpdateMarkerPopups();
        _mrRenderSummary(_mrLastResult);
    } catch (_) {
        clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// Cálculo da rota
// ---------------------------------------------------------------------------
function _mrScheduleCompute(delay = 0, meta = {}) {
    clearTimeout(_mrCalcTimer);
    _mrCalcTimer = setTimeout(() => _mrCompute(meta), delay);
}

async function _mrCompute(meta = {}) {
    if (!_mrOpen) return;
    const token = ++_mrCalcToken;
    const stops = _mrResolvedStops();

    _mrDrawMarkers();

    if (stops.length < 2) {
        _mrRemoveRouteLines();
        _mrLastResult = null;
        _mrRenderSummary(null);
        return;
    }

    _mrRenderSummary({ loading: true, text: 'Calculando rota...' });

    // Limpa a rota simples (origem → feição), se houver
    if (typeof map !== 'undefined' && map) {
        if (window.distanceLine) { map.removeLayer(window.distanceLine); window.distanceLine = null; }
        if (window.distanceMarker) { map.removeLayer(window.distanceMarker); window.distanceMarker = null; }
        if (window.routingControl) { map.removeControl(window.routingControl); window.routingControl = null; }
    }

    // Oculta polígonos para destacar a rota (sem recolher a sidebar)
    if (!_mrEnteredRouteView && typeof window.enterRouteViewMode === 'function') {
        _mrEnteredRouteView = true;
        try { await window.enterRouteViewMode({ collapseSidebar: false }); } catch (_) {}
        if (token !== _mrCalcToken) return;
    }

    let result = null;
    let osrmFailed = false;

    if (navigator.onLine) {
        result = await _mrFetchOsrm(stops);
        if (token !== _mrCalcToken) return;
        if (!result) osrmFailed = true;
    }

    if (!result) {
        result = await _mrOfflineRoute(stops, token);
        if (token !== _mrCalcToken || !result) return;
    }

    result.stops = stops.map(s => ({ ...s }));
    _mrLastResult = result;

    _mrDrawRoute(result);
    _mrRenderSummary(result);
    _mrUpdateMarkerPopups();

    if (osrmFailed) {
        showToast('Servidor de rotas indisponível. Exibindo rota aproximada.', 'warning', 4500);
    }

    // Mobile: rota completa → mostra o mapa
    const allFilled = _mrStops.every(_mrIsResolved);
    if (meta.fromUser && allFilled && _mrIsMobile()) {
        if (typeof _closeSidebar === 'function') _closeSidebar();
        const last = _mrLayer && _mrLayer._mrMarkers ? _mrLayer._mrMarkers[_mrLayer._mrMarkers.length - 1] : null;
        if (last) setTimeout(() => last.openPopup(), 350);
    }
}

function _mrOsrmKey(stops) {
    return stops.map(s => `${s.lng.toFixed(5)},${s.lat.toFixed(5)}`).join(';');
}

async function _mrFetchOsrm(stops) {
    const key = _mrOsrmKey(stops);
    if (_mrOsrmCache.has(key)) {
        const cached = _mrOsrmCache.get(key);
        _mrOsrmCache.delete(key);
        _mrOsrmCache.set(key, cached);
        return JSON.parse(JSON.stringify(cached));
    }

    const profile = (typeof getNetworkProfile === 'function')
        ? getNetworkProfile() : { osrmTimeout: 4500 };
    // Traçado completo com vários pontos é mais pesado que a consulta simples
    const timeoutMs = Math.max((profile.osrmTimeout || 4500) * 2, 8000);

    const coords = stops.map(s => `${s.lng.toFixed(6)},${s.lat.toFixed(6)}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&alternatives=false`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) return null;
        const data = await resp.json();
        const route = data?.routes?.[0];
        if (data.code !== 'Ok' || !route?.geometry?.coordinates?.length) return null;

        const line = route.geometry.coordinates.map(c => [c[1], c[0]]);
        const wps = (data.waypoints || []).map(w => [w.location[1], w.location[0]]);
        const legLines = _mrSplitLine(line, wps.length === stops.length ? wps : stops.map(s => [s.lat, s.lng]));

        const result = {
            source: 'road',
            distance: route.distance,
            duration: route.duration,
            legs: (route.legs || []).map((leg, i) => ({
                distance: leg.distance,
                duration: leg.duration,
                source: 'road',
                line: legLines[i] || []
            }))
        };

        // Alimenta o cache de distâncias usado pelo restante do app
        if (window.DB && typeof DB.saveCachedRoute === 'function') {
            result.legs.forEach((leg, i) => {
                const a = stops[i], b = stops[i + 1];
                if (!a || !b) return;
                const routeKey = `${a.lat.toFixed(4)},${a.lng.toFixed(4)}_${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
                DB.saveCachedRoute(routeKey, leg.distance, leg.duration).catch(() => {});
            });
        }

        if (_mrOsrmCache.size >= MR_OSRM_CACHE_MAX) {
            _mrOsrmCache.delete(_mrOsrmCache.keys().next().value);
        }
        _mrOsrmCache.set(key, result);
        return JSON.parse(JSON.stringify(result));
    } catch (e) {
        clearTimeout(timer);
        console.warn('[Rota] OSRM indisponível:', e.message || e);
        return null;
    }
}

/**
 * Divide o traçado completo em trechos, localizando (em ordem) o vértice
 * mais próximo de cada ponto de parada.
 */
function _mrSplitLine(line, waypoints) {
    if (!line.length || waypoints.length < 2) return [line];
    const idxs = [0];
    let from = 0;
    for (let w = 1; w < waypoints.length - 1; w++) {
        const [wLat, wLng] = waypoints[w];
        let best = from, bestD = Infinity;
        for (let i = from; i < line.length; i++) {
            const d = (line[i][0] - wLat) ** 2 + (line[i][1] - wLng) ** 2;
            if (d < bestD) { bestD = d; best = i; }
        }
        idxs.push(best);
        from = best;
    }
    idxs.push(line.length - 1);

    const legs = [];
    for (let i = 0; i < idxs.length - 1; i++) {
        legs.push(line.slice(idxs[i], idxs[i + 1] + 1));
    }
    return legs;
}

/**
 * Sem internet (ou OSRM fora): cada trecho pela malha local de
 * logradouros; se não houver malha, linha reta.
 */
async function _mrOfflineRoute(stops, token) {
    const legs = [];
    const totalLegs = stops.length - 1;

    for (let i = 0; i < totalLegs; i++) {
        if (token !== _mrCalcToken) return null;
        const a = stops[i], b = stops[i + 1];

        if (totalLegs > 1) {
            _mrRenderSummary({ loading: true, text: `Calculando trecho ${i + 1} de ${totalLegs} (sem internet)...` });
        }

        let leg = null;
        if (typeof findApproxOfflineRoute === 'function') {
            try {
                const r = await findApproxOfflineRoute(a.lat, a.lng, b.lat, b.lng);
                if (r && Array.isArray(r.path) && r.path.length >= 2) {
                    const line = [[a.lat, a.lng], ...r.path.map(c => [c[1], c[0]]), [b.lat, b.lng]];
                    leg = { distance: r.distanceMeters, duration: null, source: 'approx', line };
                }
            } catch (e) {
                console.warn('[Rota] rota offline falhou no trecho', i + 1, e);
            }
        }

        if (!leg) {
            const dist = turf.distance(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]), { units: 'meters' });
            leg = { distance: dist, duration: null, source: 'straight', line: [[a.lat, a.lng], [b.lat, b.lng]] };
        }
        legs.push(leg);
    }

    const sources = new Set(legs.map(l => l.source));
    return {
        source: sources.size === 1 ? legs[0].source : 'mixed',
        distance: legs.reduce((s, l) => s + l.distance, 0),
        duration: null,
        legs
    };
}

// ---------------------------------------------------------------------------
// Desenho no mapa
// ---------------------------------------------------------------------------
function _mrEnsureLayer() {
    if (typeof map === 'undefined' || !map) return null;
    if (!_mrLayer) {
        _mrLayer = L.layerGroup().addTo(map);
        _mrLayer._mrMarkers = [];
        _mrLayer._mrLines = [];
    }
    return _mrLayer;
}

function _mrClearMapLayers() {
    if (_mrLayer && typeof map !== 'undefined' && map) map.removeLayer(_mrLayer);
    _mrLayer = null;
}

/**
 * Limpa o painel de análise de POIs e invalida qualquer execução em voo.
 * Chamado sempre que a rota muda (stop alterado, removido, reordenado,
 * invertido ou rota encerrada).
 */
function _mrClearPoiPanel() {
    const container = document.getElementById('mrPoiSummary');
    if (container) {
        container.innerHTML = '';
        container.classList.add('hidden');
    }
    // Invalida análises em voo para que não sobrescrevam a UI
    _mrPoiAnalysisToken++;
}

function _mrRemoveRouteLines() {
    if (!_mrLayer) return;
    _mrLayer._mrLines.forEach(l => _mrLayer.removeLayer(l));
    _mrLayer._mrLines = [];
}

function _mrIcon(letter, role) {
    return L.divIcon({
        className: 'mr-pin-wrap',
        html: `<div class="mr-pin mr-pin--${role}"><span>${letter}</span></div>`,
        // Quadrado de 30px girado 45°: a ponta fica ~21px abaixo do centro
        iconSize: [30, 30],
        iconAnchor: [15, 36],
        popupAnchor: [0, -40]
    });
}

function _mrDrawMarkers() {
    const layer = _mrEnsureLayer();
    if (!layer) return;

    layer._mrMarkers.forEach(m => layer.removeLayer(m));
    layer._mrMarkers = [];

    const total = _mrStops.length;
    _mrStops.forEach((stop, index) => {
        if (!_mrIsResolved(stop)) return;
        const marker = L.marker([stop.lat, stop.lng], {
            icon: _mrIcon(_mrLetter(index), _mrRole(index, total)),
            draggable: true,
            zIndexOffset: 2000,
            title: `${_mrLetter(index)}: ${stop.label}`,
            keyboard: true
        });
        marker._mrStopId = stop.id;
        marker.on('dragend', () => {
            const p = marker.getLatLng();
            const label = `Ponto no mapa (${_mrCoordLabel(p.lat, p.lng)})`;
            _mrSetStop(stop.id, { lat: p.lat, lng: p.lng, label, address: label }, {
                advanceFocus: false,
                reverseGeocode: true
            });
        });
        marker.bindPopup('', { className: 'feature-popup', maxWidth: 300, minWidth: 220, autoPanPadding: [30, 50] });
        marker.on('popupopen', () => _mrEnrichMarkerPopup(marker));
        marker.addTo(layer);
        layer._mrMarkers.push(marker);
    });

    _mrUpdateMarkerPopups();
}

/**
 * Constrói o HTML do popup de um pino, opcionalmente incluindo a lista
 * de POIs próximos (Superfície A).
 */
function _mrBuildPopupContent(stop, index, options = {}) {
    const { pois = null, isLoadingPoi = false } = options;
    const total = _mrStops.length;
    const letter = _mrLetter(index);
    const resolved = _mrResolvedStops();
    const lastResolvedId = resolved.length ? resolved[resolved.length - 1].id : null;
    const res = _mrLastResult;

    let totals = '';
    if (res && stop.id === lastResolvedId && resolved.length >= 2) {
        totals = `<div class="mr-popup-total">
            <b>Total:</b> ${_mrFmtDist(res.distance)}${res.duration ? ` · ~${_mrFmtTime(res.duration)}` : ''}
            <small>${resolved.length} pontos · ${escapeHtml(_mrSourceText(res.source))}</small>
        </div>`;
    }

    let poisHtml = '';
    if (isLoadingPoi) {
        poisHtml = `<div class="mr-poi-loading"><span class="mr-spinner"></span> Buscando POIs próximos...</div>`;
    } else if (pois) {
        poisHtml = _mrRenderPoiInline(pois);
    }

    return `
        <div class="route-popup">
            <span class="route-popup-title"><span class="mr-popup-letter mr-badge mr-badge--${_mrRole(index, total)}">${letter}</span> ${escapeHtml(_mrPlaceholder(index, total))}</span>
            <div class="route-popup-body">
                ${escapeHtml(stop.address || stop.label)}
                ${totals}
                <small class="route-popup-muted">Arraste o pino para ajustar.</small>
                ${poisHtml}
            </div>
        </div>`;
}

function _mrUpdateMarkerPopups() {
    if (!_mrLayer) return;
    _mrLayer._mrMarkers.forEach(marker => {
        const index = _mrStops.findIndex(s => s.id === marker._mrStopId);
        if (index < 0) return;
        const stop = _mrStops[index];

        // Se o popup já foi enriquecido com POIs, preserva o estado
        const key = (stop.lat != null && stop.lng != null)
            ? `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`
            : null;
        const cachedPois = key ? _mrPoiCache.get(key) : null;

        marker.setPopupContent(_mrBuildPopupContent(stop, index, { pois: cachedPois }));
    });
}

/**
 * Renderiza a lista compacta de POIs no popup do pino (Superfície A).
 * Cada item tem DOIS botões:
 *   • Principal (linha)  → adiciona o POI como parada da rota
 *   • Secundário (🔍)   → apenas centraliza o mapa no POI
 */
function _mrRenderPoiInline(pois) {
    const blocks = [];

    const renderItem = (it, iconKey) => {
        const name    = _mrPoiDisplayName(it);
        const dist    = _mrFmtDist(it.distanceKm * 1000);
        const safeName = escapeHtml(name);
        return `<div class="mr-poi-row">
            <button type="button" class="mr-poi-add"
                    data-cobom-action="add-mr-stop"
                    data-lat="${it.coord.lat}"
                    data-lng="${it.coord.lng}"
                    data-name="${safeName}"
                    title="Adicionar &quot;${safeName}&quot; à rota (${dist})">
                <span class="mr-poi-icon">${svgIcon(iconKey, 11)}</span>
                <span class="mr-poi-name">${safeName}</span>
                <span class="mr-poi-distance">${dist}</span>
            </button>
            <button type="button" class="mr-poi-locate"
                    data-cobom-action="zoom-to"
                    data-lat="${it.coord.lat}"
                    data-lng="${it.coord.lng}"
                    data-zoom="17"
                    title="Centralizar mapa neste POI"
                    aria-label="Centralizar mapa em ${safeName}">
                ${svgIcon('search', 11)}
            </button>
        </div>`;
    };

    const section = (iconKey, label, items) => {
        if (!items || items.length === 0) return '';
        return `<div class="mr-poi-section">
            <div class="mr-poi-section-title">${svgIcon(iconKey, 10)} ${label}</div>
            ${items.map(it => renderItem(it, iconKey)).join('')}
        </div>`;
    };

    if (pois.units?.length)     blocks.push(section('truck',    'Unidades BM',     pois.units));
    if (pois.hospitals?.length) blocks.push(section('hospital', 'Hospitais',       pois.hospitals));
    if (pois.hydrants?.length)  blocks.push(section('droplet',  'Hidrantes',       pois.hydrants));
    if (pois.events?.length)    blocks.push(section('flame',    'Eventos de Fogo', pois.events));

    if (blocks.length === 0) return '';
    return `<div class="mr-poi-list">${blocks.join('')}</div>`;
}

/**
 * Nome amigável por tipo de POI.
 */
function _mrPoiDisplayName(item) {
    const p = item.properties || {};
    const f = item.feature;
    const cls = getFeatureClassification(f);
    if (cls === 'UNIDADE_BM') return p.name || p['Nome da Unidade'] || 'Unidade BM';
    if (cls === 'HOSPITAL')   return p['Nome do Hospital'] || p.name || 'Hospital';
    if (cls === 'HIDRANTE')   return `Hidrante ${p.numHidrante || p.codigo || p.id || 's/n'}`;
    if (cls === 'EVENTO_FOGO') return `Evento #${p.id_evento ?? '-'}`;
    return 'POI';
}

/**
 * Enriquece o popup de um pino com POIs ao abrir (lazy + cache).
 */
async function _mrEnrichMarkerPopup(marker) {
    const stop = _mrFindStop(marker._mrStopId);
    if (!stop || !_mrIsResolved(stop)) return;
    if (typeof findNearbyPOIs !== 'function') return;

    const key = `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`;

    // Cache hit → renderiza direto
    if (_mrPoiCache.has(key)) {
        const idx = _mrStops.findIndex(s => s.id === stop.id);
        if (idx >= 0 && marker.isPopupOpen()) {
            marker.setPopupContent(_mrBuildPopupContent(stop, idx, { pois: _mrPoiCache.get(key) }));
        }
        return;
    }

    const idx = _mrStops.findIndex(s => s.id === stop.id);
    if (idx < 0) return;

    // Estado de loading (não bloqueia a UI)
    if (marker.isPopupOpen()) {
        marker.setPopupContent(_mrBuildPopupContent(stop, idx, { isLoadingPoi: true }));
    }

    try {
        const pois = await findNearbyPOIs(stop.lat, stop.lng, {
            maxDistanceKm: 5,
            topUnits: 3, topHospitals: 2, topHydrants: 3, topEvents: 2
        });
        _mrPoiCache.set(key, pois);

        // Só aplica se o popup do mesmo marcador ainda estiver aberto
        if (marker.isPopupOpen() && _mrFindStop(stop.id)?.lat === stop.lat) {
            const idx2 = _mrStops.findIndex(s => s.id === stop.id);
            if (idx2 >= 0) {
                marker.setPopupContent(_mrBuildPopupContent(stop, idx2, { pois }));
            }
        }
    } catch (e) {
        console.warn('[Rota] Falha ao buscar POIs:', e);
    }
}

function _mrDrawRoute(result) {
    const layer = _mrEnsureLayer();
    if (!layer) return;
    _mrRemoveRouteLines();

    const add = l => { l.addTo(layer); layer._mrLines.push(l); return l; };
    const bounds = L.latLngBounds([]);

    result.legs.forEach((leg, i) => {
        if (!leg.line || leg.line.length < 2) return;
        const color = MR_COLORS[leg.source] || MR_COLORS.road;
        const dashed = leg.source !== 'road';

        if (leg.source !== 'straight') {
            add(L.polyline(leg.line, {
                color: '#ffffff', weight: 9, opacity: 0.85,
                lineJoin: 'round', lineCap: 'round', interactive: false
            }));
        }
        const line = add(L.polyline(leg.line, {
            color,
            weight: leg.source === 'straight' ? 3 : 5,
            opacity: 0.92,
            dashArray: dashed ? (leg.source === 'straight' ? '8,6' : '10,6') : null,
            lineJoin: 'round',
            lineCap: 'round'
        }));
        line.bindTooltip(
            `${_mrLetter(i)} → ${_mrLetter(i + 1)}: ${_mrFmtDist(leg.distance)}${leg.duration ? ` · ${_mrFmtTime(leg.duration)}` : ''}`,
            { sticky: true, className: 'feature-tooltip' }
        );
        leg.line.forEach(p => bounds.extend(p));
    });

    // Pinos por cima das linhas
    layer._mrMarkers.forEach(m => { layer.removeLayer(m); layer.addLayer(m); });

    if (bounds.isValid() && typeof map !== 'undefined' && map) {
        const sidebar = document.getElementById('sidebar');
        const sidebarOpen = sidebar && !sidebar.classList.contains('collapsed') && !_mrIsMobile();
        map.fitBounds(bounds, {
            paddingTopLeft: [sidebarOpen ? (sidebar.offsetWidth + 40) : 40, 60],
            paddingBottomRight: [60, 40],
            maxZoom: 17
        });
    }
}

function _mrFocusLeg(index) {
    const leg = _mrLastResult?.legs?.[index];
    if (!leg || !leg.line?.length || typeof map === 'undefined' || !map) return;
    const sidebar = document.getElementById('sidebar');
    const sidebarOpen = sidebar && !sidebar.classList.contains('collapsed') && !_mrIsMobile();
    map.fitBounds(L.latLngBounds(leg.line), {
        paddingTopLeft: [sidebarOpen ? (sidebar.offsetWidth + 40) : 40, 60],
        paddingBottomRight: [60, 40],
        maxZoom: 17
    });
    if (_mrIsMobile() && typeof _closeSidebar === 'function') _closeSidebar();
}

// ---------------------------------------------------------------------------
// Resumo (total + trechos)
// ---------------------------------------------------------------------------
function _mrSourceText(source) {
    switch (source) {
        case 'road': return 'Rota pelas vias';
        case 'approx': return 'Rota aproximada (sem internet)';
        case 'straight': return 'Linha reta (sem malha de vias)';
        case 'mixed': return 'Aproximada / linha reta (sem internet)';
        default: return '';
    }
}

function _mrRenderSummary(result) {
    const box = document.getElementById('mrSummary');
    if (!box) return;

    if (!result) {
        const filled = _mrResolvedStops().length;
        box.innerHTML = filled < 2
            ? `<div class="mr-hint">${svgIcon('info', 13)} Defina pelo menos dois pontos para calcular a rota.</div>`
            : '';
        return;
    }

    if (result.loading) {
        box.innerHTML = `<div class="mr-hint mr-hint--loading"><span class="mr-spinner" aria-hidden="true"></span>${escapeHtml(result.text || 'Calculando...')}</div>`;
        return;
    }

    const stops = result.stops || _mrResolvedStops();
    const letters = stops.map(s => {
        const idx = _mrStops.findIndex(x => x.id === s.id);
        return idx >= 0 ? _mrLetter(idx) : '?';
    });
    const roles = stops.map(s => {
        const idx = _mrStops.findIndex(x => x.id === s.id);
        return _mrRole(idx, _mrStops.length);
    });
    const pending = _mrStops.length - stops.length;

    const legsHtml = result.legs.map((leg, i) => {
        const from = _mrFindStop(stops[i].id) || stops[i];
        const to = _mrFindStop(stops[i + 1].id) || stops[i + 1];
        const approx = leg.source !== 'road';
        return `
            <button type="button" class="mr-leg" data-mr-leg="${i}" title="Ver este trecho no mapa">
                <span class="mr-leg-letters">
                    <span class="mr-badge mr-badge--sm mr-badge--${roles[i]}">${letters[i]}</span>
                    ${svgIcon('arrow-right', 11)}
                    <span class="mr-badge mr-badge--sm mr-badge--${roles[i + 1]}">${letters[i + 1]}</span>
                </span>
                <span class="mr-leg-names">${escapeHtml(from.label)} → ${escapeHtml(to.label)}</span>
                <span class="mr-leg-values">
                    <b>${approx ? '~' : ''}${_mrFmtDist(leg.distance)}</b>
                    ${leg.duration ? `<small>${_mrFmtTime(leg.duration)}</small>` : ''}
                </span>
            </button>`;
    }).join('');

    const totalTime = result.duration ? ` · ~${_mrFmtTime(result.duration)}` : '';
    const approxTotal = result.source !== 'road' ? '~' : '';

    box.innerHTML = `
        <div class="mr-total mr-total--${result.source}">
            <div class="mr-total-main">${approxTotal}${_mrFmtDist(result.distance)}<span>${totalTime}</span></div>
            <div class="mr-total-sub">${escapeHtml(_mrSourceText(result.source))}${result.duration ? ' · tempo sem trânsito' : ''}</div>
        </div>
        ${pending > 0 ? `<div class="mr-hint">${svgIcon('info', 13)} ${pending === 1 ? '1 ponto vazio foi ignorado' : `${pending} pontos vazios foram ignorados`}.</div>` : ''}
        <div class="mr-legs">${legsHtml}</div>
        <div class="mr-summary-actions">
            <button type="button" class="mr-link-btn" data-mr-action="copy">${svgIcon('copy', 13)} Copiar resumo</button>
            <button type="button" class="mr-link-btn" data-cobom-action="open-external" data-url="${escapeHtml(_mrGoogleMapsUrl(stops))}" title="Abrir esta rota no Google Maps">${svgIcon('map', 13)} Google Maps</button>
        </div>`;
}

function _mrGoogleMapsUrl(stops) {
    const fmt = s => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
    const params = new URLSearchParams({
        api: '1',
        origin: fmt(stops[0]),
        destination: fmt(stops[stops.length - 1]),
        travelmode: 'driving'
    });
    if (stops.length > 2) params.set('waypoints', stops.slice(1, -1).map(fmt).join('|'));
    return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function _mrCopySummary() {
    const res = _mrLastResult;
    if (!res) return;
    const stops = res.stops || _mrResolvedStops();
    const lines = [];
    lines.push('ROTA – COBOM-BH');
    stops.forEach((s, i) => {
        const cur = _mrFindStop(s.id) || s;
        const idx = _mrStops.findIndex(x => x.id === s.id);
        // Não repete as coordenadas quando o rótulo já é uma coordenada
        const hasCoords = /-?\d{1,3}\.\d{3,}/.test(cur.label);
        lines.push(`${idx >= 0 ? _mrLetter(idx) : i + 1}) ${cur.label}${hasCoords ? '' : ` (${_mrCoordLabel(cur.lat, cur.lng)})`}`);
    });
    res.legs.forEach((leg, i) => {
        const a = _mrStops.findIndex(x => x.id === stops[i].id);
        const b = _mrStops.findIndex(x => x.id === stops[i + 1].id);
        lines.push(`${_mrLetter(a)}→${_mrLetter(b)}: ${leg.source !== 'road' ? '~' : ''}${_mrFmtDist(leg.distance)}${leg.duration ? `, ${_mrFmtTime(leg.duration)}` : ''}`);
    });
    lines.push(`TOTAL: ${res.source !== 'road' ? '~' : ''}${_mrFmtDist(res.distance)}${res.duration ? `, ~${_mrFmtTime(res.duration)} (sem trânsito)` : ''}`);
    const text = lines.join('\n');

    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => showToast('Resumo da rota copiado.', 'success', 2200))
            .catch(() => showToast('Não foi possível copiar.', 'warning'));
    } else {
        showToast('Área de transferência indisponível.', 'warning');
    }
}

// ---------------------------------------------------------------------------
// SUPERFÍCIE B — Análise consolidada de POIs na rota
// ---------------------------------------------------------------------------
async function _mrAnalyzeRoutePOIs() {
    const container = document.getElementById('mrPoiSummary');
    const btn = document.getElementById('mrAnalyzeBtn');
    if (!container) return;

    const stops = _mrResolvedStops();
    if (stops.length < 2) {
        container.classList.add('hidden');
        return;
    }
    if (typeof findNearbyPOIs !== 'function') {
        showToast('Módulo de POIs não disponível.', 'warning');
        return;
    }

    // Token de geração — evita que uma análise antiga sobrescreva a nova
    const token = ++_mrPoiAnalysisToken;
    const signature = stops.map(s => s.id).join(',');

    if (btn) btn.disabled = true;
    container.classList.remove('hidden');
    container.innerHTML = `<div class="mr-hint mr-hint--loading"><span class="mr-spinner" aria-hidden="true"></span> Analisando POIs próximos de ${stops.length} paradas...</div>`;

    try {
        const layers = await DB.getLayers();
        if (token !== _mrPoiAnalysisToken) return;

        const results = [];
        for (const stop of stops) {
            if (token !== _mrPoiAnalysisToken) return;

            const key = `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`;
            let pois = _mrPoiCache.get(key);
            if (!pois) {
                pois = await findNearbyPOIs(stop.lat, stop.lng, {
                    maxDistanceKm: 5,
                    topUnits: 2, topHospitals: 1, topHydrants: 2, topEvents: 1,
                    layers
                });
                if (token !== _mrPoiAnalysisToken) return;
                _mrPoiCache.set(key, pois);
            }
            results.push({ stop, pois });
        }

        // Segunda verificação: token + assinatura dos stops
        if (token !== _mrPoiAnalysisToken) return;
        const currentSig = _mrResolvedStops().map(s => s.id).join(',');
        if (currentSig !== signature) return;

        _mrRenderPoiAnalysis(container, results);
    } catch (e) {
        if (token === _mrPoiAnalysisToken) {
            console.error('[Rota] Erro ao analisar POIs:', e);
            container.innerHTML = `<div class="mr-hint">Não foi possível analisar os POIs.</div>`;
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

function _mrRenderPoiAnalysis(container, results) {
    const anyPoi = results.some(r =>
        r.pois.units.length || r.pois.hospitals.length ||
        r.pois.hydrants.length || r.pois.events.length
    );

    if (!anyPoi) {
        container.innerHTML = `<div class="mr-hint">${svgIcon('info', 12)} Nenhum POI mapeado num raio de 5 km das paradas.</div>`;
        return;
    }

    const renderItem = (it, iconKey) => {
        const name     = _mrPoiDisplayName(it);
        const dist     = _mrFmtDist(it.distanceKm * 1000);
        const safeName = escapeHtml(name);
        return `<div class="mr-poi-row">
            <button type="button" class="mr-poi-add"
                    data-cobom-action="add-mr-stop"
                    data-lat="${it.coord.lat}"
                    data-lng="${it.coord.lng}"
                    data-name="${safeName}"
                    title="Adicionar &quot;${safeName}&quot; à rota (${dist})">
                <span class="mr-poi-icon">${svgIcon(iconKey, 11)}</span>
                <span class="mr-poi-name">${safeName}</span>
                <span class="mr-poi-distance">${dist}</span>
            </button>
            <button type="button" class="mr-poi-locate"
                    data-cobom-action="zoom-to"
                    data-lat="${it.coord.lat}"
                    data-lng="${it.coord.lng}"
                    data-zoom="17"
                    title="Centralizar mapa neste POI"
                    aria-label="Centralizar mapa em ${safeName}">
                ${svgIcon('search', 11)}
            </button>
        </div>`;
    };

    const blocks = results.map(({ stop, pois }) => {
        const idx    = _mrStops.findIndex(s => s.id === stop.id);
        const letter = idx >= 0 ? _mrLetter(idx) : '?';
        const role   = idx >= 0 ? _mrRole(idx, _mrStops.length) : 'mid';

        const sections = [];
        const addSection = (iconKey, label, items) => {
            if (!items.length) return;
            sections.push(`<div class="mr-poi-section">
                <div class="mr-poi-section-title">${svgIcon(iconKey, 10)} ${label}</div>
                ${items.map(it => renderItem(it, iconKey)).join('')}
            </div>`);
        };

        addSection('truck',    'Unidades BM',     pois.units);
        addSection('hospital', 'Hospitais',       pois.hospitals);
        addSection('droplet',  'Hidrantes',       pois.hydrants);
        addSection('flame',    'Eventos de Fogo', pois.events);

        return `<div class="mr-poi-stop-block">
            <div class="mr-poi-stop-header">
                <span class="mr-badge mr-badge--sm mr-badge--${role}">${letter}</span>
                ${escapeHtml(stop.label || 'Parada')}
            </div>
            ${sections.length ? sections.join('') : '<div class="mr-poi-empty">Sem POIs próximos.</div>'}
        </div>`;
    }).join('');

    container.innerHTML = blocks;
}

/**
 * Adiciona um POI como parada da rota atual.
 *
 * Regras:
 *   • Se houver uma parada VAZIA (não resolvida), preenche-a primeiro —
 *     evita "buracos" na rota.
 *   • Se todas as paradas estiverem preenchidas, ACRESCENTA uma nova
 *     parada ao final (limite MR_MAX_STOPS).
 *   • Dispara o recálculo da rota e um toast de confirmação.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string} name  Nome do POI (usado como label da parada)
 * @returns {object|null} O stop criado/preenchido, ou null em caso de erro
 */
function addStopFromCoords(lat, lng, name) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    if (!_mrOpen) {
        openMultiRoute({ focus: false });
    }

    const safeName = String(name || 'POI').trim() || 'POI';

    // 1) Preenche primeiro stop vazio
    const emptyStop = _mrStops.find(s => !_mrIsResolved(s));
    let targetStop;
    let isNew = false;

    if (emptyStop) {
        targetStop = emptyStop;
    } else {
        if (_mrStops.length >= MR_MAX_STOPS) {
            showToast(`Limite de ${MR_MAX_STOPS} pontos por rota.`, 'warning', 3000);
            return null;
        }
        targetStop = _mrNewStop();
        _mrStops.push(targetStop);
        isNew = true;
    }

    targetStop.lat = lat;
    targetStop.lng = lng;
    targetStop.label = safeName;
    targetStop.address = safeName;

    // Painel de POIs fica obsoleto com a nova parada
    _mrClearPoiPanel();
    _mrRenderStops();
    _mrScheduleCompute(0, { fromUser: true });

    const idx    = _mrStops.indexOf(targetStop);
    const letter = _mrLetter(idx);
    const verb   = isNew ? 'adicionado como ponto' : 'definido no ponto';
    showToast(`POI "${safeName}" ${verb} ${letter}.`, 'success', 2500);

    return targetStop;
}

// ---------------------------------------------------------------------------
// Esc global (chamado por app.js)
// ---------------------------------------------------------------------------
function _mrHandleEscape() {
    if (_mrCancelPick(false)) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
function initMultiRoute() {
    const toggleBtn = document.getElementById('multiRouteBtn');
    const panel = document.getElementById('multiRoutePanel');
    if (!toggleBtn || !panel) return;

    toggleBtn.addEventListener('click', toggleMultiRoute);

    const closeBtn = document.getElementById('mrCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => closeMultiRoute());

    const addBtn = document.getElementById('mrAddStopBtn');
    if (addBtn) addBtn.addEventListener('click', () => addMultiRouteStop());

    const reverseBtn = document.getElementById('mrReverseBtn');
    if (reverseBtn) reverseBtn.addEventListener('click', _mrReverseStops);

    // NOVO: análise consolidada de POIs
    const analyzeBtn = document.getElementById('mrAnalyzeBtn');
    if (analyzeBtn) analyzeBtn.addEventListener('click', _mrAnalyzeRoutePOIs);

    // Delegação dos botões de cada ponto
    const list = document.getElementById('mrStopsList');
    if (list) {
        list.addEventListener('click', e => {
            const btn = e.target.closest('[data-mr]');
            if (!btn || btn.disabled) return;
            const stopId = Number(btn.closest('.mr-stop')?.dataset.id);
            if (!Number.isFinite(stopId)) return;

            switch (btn.dataset.mr) {
                case 'pick':
                    if (_mrPickingId === stopId) _mrCancelPick(false);
                    else _mrStartPick(stopId);
                    break;
                case 'remove': _mrRemoveStop(stopId); break;
                case 'up': _mrMoveStop(stopId, -1); break;
                case 'down': _mrMoveStop(stopId, 1); break;
            }
        });
    }

    const summary = document.getElementById('mrSummary');
    if (summary) {
        summary.addEventListener('click', e => {
            const leg = e.target.closest('[data-mr-leg]');
            if (leg) { _mrFocusLeg(Number(leg.dataset.mrLeg)); return; }
            const action = e.target.closest('[data-mr-action]');
            if (action && action.dataset.mrAction === 'copy') _mrCopySummary();
        });
    }
}

document.addEventListener('DOMContentLoaded', initMultiRoute);

// API pública
window.MultiRoute = {
    open: openMultiRoute,
    close: closeMultiRoute,
    toggle: toggleMultiRoute,
    addStop: addMultiRouteStop,
    addStopFromCoords: addStopFromCoords,
    isOpen: () => _mrOpen,
    isPicking: () => _mrPickingId !== null,
    cancelPick: () => _mrCancelPick(true),
    pickFromFeature: _mrPickFromFeature,
    handleEscape: _mrHandleEscape,
    analyzePOIs: _mrAnalyzeRoutePOIs
};

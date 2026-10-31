// js/sids-calls.js — Painel flutuante de chamadas SIDS (desktop-only)
// ---------------------------------------------------------------------------
// Caderno operacional de rascunho: cola chamadas do SIDS, persiste, resolve
// endereços sob demanda e envia para o mapa (origem) ou para o MultiRoute.
//
// Autor: Jeferson Manini — atualização v18
//
// Dependências: search.js (parseCadCalls, parseCadAddress, geocodeCadAddress),
//               map.js (setOrigin, calculateDistancesToAllFeatures),
//               multiroute.js (MultiRoute.addStopFromCoords),
//               utils.js (svgIcon, escapeHtml, showToast, normalizeStr)
// ===========================================================================

const SIDS_STORAGE_KEY = 'cobom_sids_calls_v1';
const SIDS_MAX_CALLS   = 10;

let _sidsCalls    = [];
let _sidsSelected = new Set();   // ids marcados p/ rota em lote
let _sidsOpen     = false;
let _sidsInitialized = false;

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------
function _sidsLoad() {
    try {
        const raw = localStorage.getItem(SIDS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(c =>
            c && typeof c.id === 'string' && typeof c.address === 'string'
        );
    } catch (e) {
        console.warn('[SidsCalls] Falha ao carregar:', e);
        return [];
    }
}

function _sidsSave() {
    try {
        localStorage.setItem(SIDS_STORAGE_KEY, JSON.stringify(_sidsCalls));
    } catch (e) {
        console.warn('[SidsCalls] Falha ao salvar:', e);
        if (typeof showToast === 'function') {
            showToast('Não foi possível salvar as chamadas (armazenamento cheio).', 'warning', 4000);
        }
    }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
function _sidsGenId() {
    return `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function _sidsGet(id) {
    return _sidsCalls.find(c => c.id === id) || null;
}

/**
 * Adiciona um lote de chamadas com deduplicação por protocolo e
 * limite de SIDS_MAX_CALLS. Retorna { added, duplicates, dropped }.
 */
function addCalls(calls) {
    if (!Array.isArray(calls) || calls.length === 0) return null;

    let added = 0, duplicates = 0, dropped = 0;

    for (const raw of calls) {
        if (!raw || !raw.address) continue;

        const proto = String(raw.protocol || '').trim();
        if (proto && _sidsCalls.some(c => c.protocol === proto)) {
            duplicates++;
            continue;
        }
        if (_sidsCalls.length >= SIDS_MAX_CALLS) {
            dropped++;
            continue;
        }

        _sidsCalls.push({
            id: _sidsGenId(),
            protocol: proto,
            datetime: raw.datetime || '',
            nature: raw.nature || '',
            natureCode: raw.natureCode || '',
            natureRaw: raw.natureRaw || '',
            address: raw.address,
            unit: raw.unit || '',
            vehicle: raw.vehicle || '',
            lat: null,
            lng: null,
            displayName: null,
            resolvedAt: null,
            createdAt: Date.now()
        });
        added++;
    }

    if (added > 0) {
        _sidsSave();
        _sidsRenderPanel();
        _sidsUpdateBadge();
    }
    return { added, duplicates, dropped };
}

function _sidsRemove(id) {
    const idx = _sidsCalls.findIndex(c => c.id === id);
    if (idx < 0) return;
    _sidsCalls.splice(idx, 1);
    _sidsSelected.delete(id);
    _sidsSave();
    _sidsRenderPanel();
    _sidsUpdateBadge();
}

function _sidsClearAll() {
    if (_sidsCalls.length === 0) return;
    if (!confirm(`Excluir todas as ${_sidsCalls.length} chamada(s) guardada(s)?`)) return;
    _sidsCalls = [];
    _sidsSelected.clear();
    _sidsSave();
    _sidsRenderPanel();
    _sidsUpdateBadge();
    if (typeof showToast === 'function') {
        showToast('Lista de chamadas limpa.', 'info', 2000);
    }
}

function _sidsToggleSelect(id) {
    if (_sidsSelected.has(id)) _sidsSelected.delete(id);
    else _sidsSelected.add(id);
    _sidsRenderPanel();
}

// ---------------------------------------------------------------------------
// Resolução de endereço (sem TTL — reutiliza lat/lng salvos indefinidamente)
// ---------------------------------------------------------------------------
async function _sidsResolve(call) {
    if (!call) return false;
    if (Number.isFinite(call.lat) && Number.isFinite(call.lng)) return true;

    if (typeof geocodeCadAddress !== 'function') {
        console.warn('[SidsCalls] geocodeCadAddress indisponível.');
        return false;
    }

    const result = await geocodeCadAddress(call.address);
    if (!result) return false;

    call.lat = result.lat;
    call.lng = result.lng;
    call.displayName = result.displayName || call.address;
    call.resolvedAt = Date.now();
    _sidsSave();
    return true;
}

// ---------------------------------------------------------------------------
// Ações operacionais
// ---------------------------------------------------------------------------
async function _sidsSetAsOrigin(callId) {
    const call = _sidsGet(callId);
    if (!call) return;

    if (typeof showToast === 'function') {
        showToast(`Resolvendo endereço: ${call.protocol || 'chamada'}...`, 'info', 2000);
    }
    const ok = await _sidsResolve(call);
    if (!ok) {
        if (typeof showToast === 'function') {
            showToast(`Endereço não localizado: ${call.address}`, 'warning', 4000);
        }
        return;
    }

    const label = `${call.protocol || 'Chamada'} — ${call.nature || call.displayName || call.address}`;
    if (typeof setOrigin === 'function') {
        setOrigin(call.lat, call.lng, label);
    }
    if (typeof map !== 'undefined' && map) {
        map.setView([call.lat, call.lng], 16);
    }
    if (typeof calculateDistancesToAllFeatures === 'function') {
        calculateDistancesToAllFeatures(call.lat, call.lng);
    }
    if (typeof showToast === 'function') {
        showToast(`Origem definida: ${call.protocol || call.displayName || 'chamada'}`, 'success', 3000);
    }
    _sidsRenderPanel(); // atualiza popup/markers
}

async function _sidsAddToRoute(callId) {
    const call = _sidsGet(callId);
    if (!call) return;

    if (typeof showToast === 'function') {
        showToast(`Resolvendo endereço: ${call.protocol || 'chamada'}...`, 'info', 2000);
    }
    const ok = await _sidsResolve(call);
    if (!ok) {
        if (typeof showToast === 'function') {
            showToast(`Endereço não localizado: ${call.address}`, 'warning', 4000);
        }
        return;
    }

    if (!window.MultiRoute) {
        if (typeof showToast === 'function') {
            showToast('Módulo de rota indisponível.', 'error', 3000);
        }
        return;
    }

    if (!window.MultiRoute.isOpen()) {
        window.MultiRoute.open({ focus: false });
    }
    window.MultiRoute.addStopFromCoords(
        call.lat, call.lng,
        `${call.protocol || 'Chamada'} — ${call.nature || call.displayName || call.address}`
    );
    _sidsRenderPanel();
}

async function _sidsRouteSelected() {
    const ids = Array.from(_sidsSelected);
    if (ids.length < 2) return;

    const calls = ids.map(_sidsGet).filter(Boolean);
    const unresolved = calls.filter(c => !Number.isFinite(c.lat) || !Number.isFinite(c.lng));

    if (unresolved.length > 0 && typeof showToast === 'function') {
        showToast(`Resolvendo ${unresolved.length} endereço(s)...`, 'info', 3000);
    }

    const resolved = await Promise.all(calls.map(async (call) => {
        if (Number.isFinite(call.lat) && Number.isFinite(call.lng)) return call;
        if (typeof geocodeCadAddress !== 'function') return null;
        try {
            const r = await geocodeCadAddress(call.address);
            if (!r) return null;
            call.lat = r.lat;
            call.lng = r.lng;
            call.displayName = r.displayName || call.address;
            call.resolvedAt = Date.now();
            return call;
        } catch (_) {
            return null;
        }
    }));

    _sidsSave();

    const valid = resolved.filter(Boolean);
    const failed = calls.length - valid.length;

    if (valid.length < 2) {
        if (typeof showToast === 'function') {
            showToast(
                `Apenas ${valid.length} de ${calls.length} endereço(s) localizado(s). Rota cancelada.`,
                'warning', 5000
            );
        }
        return;
    }

    if (!window.MultiRoute) return;

    if (!window.MultiRoute.isOpen()) {
        window.MultiRoute.open({ focus: false });
    }
    for (const call of valid) {
        window.MultiRoute.addStopFromCoords(
            call.lat, call.lng,
            `${call.protocol || 'Chamada'} — ${call.nature || call.displayName || call.address}`
        );
    }
    if (typeof showToast === 'function') {
        showToast(
            `Rota com ${valid.length} chamadas` +
            (failed > 0 ? ` (${failed} ignorada${failed > 1 ? 's' : ''})` : ''),
            'success', 4000
        );
    }

    _sidsSelected.clear();
    _sidsRenderPanel();
}

// ---------------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------------
function _sidsFmtTime(datetime) {
    const m = String(datetime || '').match(/^(\d{2})\/(\d{2})\/\d{4}\s+(\d{2}:\d{2})/);
    return m ? `${m[1]}/${m[2]} ${m[3]}` : (datetime || '');
}

function _sidsCardHtml(call, index) {
    const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s ?? ''));
    const checked = _sidsSelected.has(call.id);
    const meta = [call.unit, call.vehicle].filter(Boolean).map(esc).join(' · ');
    const proto = call.protocol || `Chamada #${index + 1}`;

    return `
        <div class="sids-calls-card ${checked ? 'is-selected' : ''}" data-call-id="${esc(call.id)}">
            <input type="checkbox" class="sids-calls-card-cb"
                   data-call-id="${esc(call.id)}"
                   ${checked ? 'checked' : ''}
                   aria-label="Selecionar chamada ${esc(proto)}">
            <div class="sids-calls-card-body">
                <div class="sids-calls-card-top">
                    <span class="sids-calls-card-proto">${svgIcon('phone', 11)} ${esc(proto)}</span>
                    ${call.datetime ? `<span class="sids-calls-card-time">${esc(_sidsFmtTime(call.datetime))}</span>` : ''}
                    <button type="button" class="sids-calls-card-del"
                            data-action="delete" data-call-id="${esc(call.id)}"
                            title="Remover chamada" aria-label="Remover chamada">
                        ${svgIcon('trash', 12)}
                    </button>
                </div>
                ${call.nature ? `
                <div class="sids-calls-card-nature" title="${esc(call.natureRaw || '')}">
                    ${esc(call.nature)}${call.natureCode ? ` <small>${esc(call.natureCode)}</small>` : ''}
                </div>` : ''}
                <div class="sids-calls-card-addr">${svgIcon('pin', 11)} ${esc(call.address)}</div>
                ${meta ? `<div class="sids-calls-card-meta">${meta}</div>` : ''}
                <div class="sids-calls-card-actions">
                    <button type="button" class="sids-calls-action"
                            data-action="origin" data-call-id="${esc(call.id)}"
                            title="Definir como origem">
                        ${svgIcon('target', 12)} Origem
                    </button>
                    <button type="button" class="sids-calls-action"
                            data-action="route" data-call-id="${esc(call.id)}"
                            title="Adicionar à rota com vários pontos">
                        ${svgIcon('route', 12)} Adicionar à rota
                    </button>
                </div>
            </div>
        </div>
    `;
}

function _sidsRenderPanel() {
    const list = document.getElementById('sidsCallsList');
    const bulk = document.getElementById('sidsCallsBulkBar');
    const bulkInfo = document.getElementById('sidsCallsBulkInfo');
    const headerCount = document.getElementById('sidsCallsHeaderCount');

    if (headerCount) headerCount.textContent = String(_sidsCalls.length);
    if (!list) return;

    if (_sidsCalls.length === 0) {
        list.innerHTML = `
            <div class="sids-calls-empty">
                ${svgIcon('info', 16)}
                <p>Nenhuma chamada guardada.</p>
                <p class="sids-calls-empty-hint">Cole acima uma ou várias linhas do SIDS e clique em <b>+ Adicionar</b>.</p>
            </div>
        `;
    } else {
        list.innerHTML = _sidsCalls.map((c, i) => _sidsCardHtml(c, i)).join('');
    }

    const nSel = _sidsSelected.size;
    if (bulk) {
        if (nSel >= 2) {
            bulk.classList.remove('hidden');
            if (bulkInfo) {
                bulkInfo.textContent = `${nSel} chamadas selecionadas`;
            }
        } else {
            bulk.classList.add('hidden');
        }
    }
}

function _sidsUpdateBadge() {
    const badge = document.getElementById('sidsCallsBadge');
    if (!badge) return;
    const n = _sidsCalls.length;
    if (n > 0) {
        badge.textContent = String(n);
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

// ---------------------------------------------------------------------------
// Parsing do input (textarea)
// ---------------------------------------------------------------------------
function _sidsParseInput(text) {
    if (!text || !text.trim()) return [];

    // 1) Caminho preferencial: parser de linhas SIDS completas
    if (typeof parseCadCalls === 'function') {
        const calls = parseCadCalls(text);
        if (calls.length > 0) return calls;
    }

    // 2) Fallback: 1 CAD-address por linha (sem tabs)
    const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
        const cad = typeof parseCadAddress === 'function' ? parseCadAddress(line) : null;
        if (cad) {
            out.push({
                protocol: '', datetime: '',
                natureCode: '', nature: '', natureRaw: '',
                address: line, unit: '', vehicle: ''
            });
        }
    }
    return out;
}

function _sidsHandleAddFromText(text) {
    const calls = _sidsParseInput(text);
    if (calls.length === 0) {
        if (typeof showToast === 'function') {
            showToast('Nenhuma chamada reconhecida no texto colado.', 'warning', 3500);
        }
        return;
    }
    const res = addCalls(calls);
    if (!res) return;

    if (typeof showToast === 'function') {
        const parts = [`${res.added} adicionada${res.added !== 1 ? 's' : ''}`];
        if (res.duplicates > 0) parts.push(`${res.duplicates} duplicada${res.duplicates !== 1 ? 's' : ''}`);
        if (res.dropped > 0)    parts.push(`${res.dropped} descartada${res.dropped !== 1 ? 's' : ''} (limite ${SIDS_MAX_CALLS})`);
        showToast(parts.join(' · '), res.added > 0 ? 'success' : 'info', 4000);
    }

    const ta = document.getElementById('sidsCallsInput');
    if (ta) {
        ta.value = '';
        _sidsUpdateAddButtonState();
    }
}

// ---------------------------------------------------------------------------
// Painel — abrir/fechar
// ---------------------------------------------------------------------------
function openSidsPanel() {
    const panel = document.getElementById('sidsCallsPanel');
    const btn = document.getElementById('sidsCallsBtn');
    if (!panel) return;
    panel.classList.remove('hidden');
    btn?.classList.add('is-active');
    btn?.setAttribute('aria-expanded', 'true');
    _sidsOpen = true;

    _sidsRenderPanel();
    _sidsUpdateBadge();

    setTimeout(() => {
        const ta = document.getElementById('sidsCallsInput');
        if (ta) ta.focus();
    }, 50);
}

function closeSidsPanel() {
    const panel = document.getElementById('sidsCallsPanel');
    const btn = document.getElementById('sidsCallsBtn');
    if (!panel) return;
    panel.classList.add('hidden');
    btn?.classList.remove('is-active');
    btn?.setAttribute('aria-expanded', 'false');
    _sidsOpen = false;
}

function toggleSidsPanel() {
    if (_sidsOpen) closeSidsPanel();
    else openSidsPanel();
}

// ---------------------------------------------------------------------------
// Estado do botão "+ Adicionar"
// ---------------------------------------------------------------------------
function _sidsUpdateAddButtonState() {
    const ta = document.getElementById('sidsCallsInput');
    const addBtn = document.getElementById('sidsCallsAddBtn');
    if (!ta || !addBtn) return;
    addBtn.disabled = ta.value.trim().length === 0;
}

// ---------------------------------------------------------------------------
// Wire-up
// ---------------------------------------------------------------------------
function _sidsWireUI() {
    const btn = document.getElementById('sidsCallsBtn');
    const panel = document.getElementById('sidsCallsPanel');
    const closeBtn = document.getElementById('sidsCallsClose');
    const ta = document.getElementById('sidsCallsInput');
    const addBtn = document.getElementById('sidsCallsAddBtn');
    const clearAllBtn = document.getElementById('sidsCallsClearAllBtn');
    const list = document.getElementById('sidsCallsList');
    const bulkRouteBtn = document.getElementById('sidsCallsBulkRouteBtn');

    if (!btn || !panel) {
        console.warn('[SidsCalls] Elementos base ausentes no DOM.');
        return;
    }

    // Toggle principal
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSidsPanel();
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeSidsPanel();
        });
    }

    // Textarea: intercepta colar múltiplas chamadas
    if (ta) {
        ta.addEventListener('input', _sidsUpdateAddButtonState);

        ta.addEventListener('paste', (e) => {
            const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
            if (!text.trim()) return;
            const calls = _sidsParseInput(text);
            if (calls.length > 0) {
                e.preventDefault();
                _sidsHandleAddFromText(text);
            }
            // Caso contrário, deixa o navegador colar normalmente
            // (texto livre — não reconhecido como chamada)
        });

        ta.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                _sidsHandleAddFromText(ta.value);
            }
        });
    }

    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const ta = document.getElementById('sidsCallsInput');
            if (ta) _sidsHandleAddFromText(ta.value);
        });
    }

    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            _sidsClearAll();
        });
    }

    // Delegação de cliques nos cards (checkbox, excluir, origem, rota)
    if (list) {
        list.addEventListener('click', async (e) => {
            const cb = e.target.closest('.sids-calls-card-cb');
            if (cb) {
                _sidsToggleSelect(cb.dataset.callId);
                return;
            }
            const actionBtn = e.target.closest('[data-action][data-call-id]');
            if (!actionBtn) return;
            const { action, callId } = actionBtn.dataset;
            switch (action) {
                case 'delete': _sidsRemove(callId); break;
                case 'origin': await _sidsSetAsOrigin(callId); break;
                case 'route':  await _sidsAddToRoute(callId); break;
            }
        });
    }

    if (bulkRouteBtn) {
        bulkRouteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await _sidsRouteSelected();
        });
    }

    // Fecha ao clicar fora
    document.addEventListener('click', (e) => {
        if (!_sidsOpen) return;
        if (panel.contains(e.target)) return;
        if (btn.contains(e.target)) return;
        closeSidsPanel();
    });

    // Esc fecha o painel (prioritário sobre outros handlers de Esc)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _sidsOpen) {
            const anyModalOpen = document.querySelector('.modal:not(.hidden)');
            if (anyModalOpen) return;
            closeSidsPanel();
            e.stopPropagation();
        }
    }, true);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function initSidsCalls() {
    if (_sidsInitialized) return;

    // Desktop only — recurso inacessível em mobile/tablet por design
    const deviceClass = (typeof getDeviceClass === 'function')
        ? getDeviceClass()
        : (window.innerWidth >= 1025 ? 'desktop' : 'mobile');

    if (deviceClass !== 'desktop') {
        console.log('[SidsCalls] Recurso disponível apenas em desktop. Ignorando inicialização.');
        return;
    }

    const btn = document.getElementById('sidsCallsBtn');
    const panel = document.getElementById('sidsCallsPanel');
    if (!btn || !panel) {
        console.warn('[SidsCalls] Botão/painel ausente no HTML — abortando init.');
        return;
    }

    _sidsCalls = _sidsLoad();
    _sidsWireUI();
    _sidsRenderPanel();
    _sidsUpdateBadge();

    _sidsInitialized = true;
    console.log(`[SidsCalls] Inicializado (${_sidsCalls.length} chamada(s) restaurada(s)).`);
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------
window.SidsCalls = {
    open: openSidsPanel,
    close: closeSidsPanel,
    toggle: toggleSidsPanel,
    addCalls: addCalls,
    list: () => _sidsCalls.slice(),
    init: initSidsCalls
};
window.openSidsPanel  = openSidsPanel;
window.closeSidsPanel = closeSidsPanel;
window.toggleSidsPanel = toggleSidsPanel;

document.addEventListener('DOMContentLoaded', initSidsCalls);
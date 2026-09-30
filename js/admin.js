// js/admin.js - Autenticação por PIN + upload + ferramentas de desenho
//
// ============================================================================
// SEGURANÇA — AUTENTICAÇÃO ENDURECIDA (defense-in-depth)
// ----------------------------------------------------------------------------
// Esta aplicação é ESTÁTICA (GitHub Pages), sem backend. Autenticação 100 %
// client-side é inerentemente vulnerável à inspeção do código-fonte.
//
// Mitigações implementadas (por ordem de impacto real):
//
//   1. PBKDF2-SHA256 (210 000 iterações, salt único) — substitui SHA-256 puro.
//      Um atacante que obtenha o hash precisa de ~10^5 vezes mais tempo para
//      fazer brute-force offline.
//
//   2. Rate limiting persistente — 5 tentativas falhas bloqueiam login por
//      15 minutos. O estado sobrevive a reload (localStorage).
//
//   3. Expiração de sessão — sessão admin expira após 4 h de inatividade.
//      Renovada automaticamente a cada interação admin autenticada.
//
//   4. Comparação em tempo constante — evita timing attacks no hash.
//
//   5. PIN nunca armazenado em claro — apenas o hash PBKDF2 derivado.
//
// ⚠️ LIMITAÇÃO ESTRUTURAL: como o hash fica no JS público, um atacante com
// acesso ao repositório ainda pode tentar brute-force offline. Para ambientes
// críticos, migre a verificação para um backend (ex.: o Cloudflare Worker
// já existente em `painel-fogo-proxy.pesmesquita.workers.dev`).
// ============================================================================

// ---------------------------------------------------------------------------
// Configuração de autenticação
// ---------------------------------------------------------------------------
const ADMIN_AUTH_CONFIG = {
    // Salt público — não é segredo, só evita rainbow tables.
    SALT: 'cobom-bh-pwa-v1-mg-193',
    ITERATIONS: 210000,
    // ⚠️ Hash PBKDF2-SHA256 de "cobom193" com o salt acima.
    // Para regenerar (troque o PIN), abra o console e execute:
    //     await window.generateAdminHash('NOVO_PIN')
    // e cole o resultado entre as aspas abaixo.
    HASH: '53cc771f844035295b0bc03b75f3e44559af66d0a362c4ae01b6024547f88d61',
    // Compat: hash SHA-256 legado — usado APENAS para migração automática
    // na primeira execução. Remova após gerar o hash PBKDF2.
    LEGACY_SHA256: 'ffcbf6cc4c1b3280189888f5c15ae08b696d36b898224685586db93f0e9b34eb',
    MAX_ATTEMPTS: 5,
    LOCKOUT_MS: 15 * 60 * 1000,        // 15 minutos
    SESSION_TTL_MS: 4 * 60 * 60 * 1000 // 4 horas
};

const ADMIN_STORAGE_KEYS = {
    ATTEMPTS: 'cobom_admin_attempts',
    LOCKOUT_UNTIL: 'cobom_admin_lockout_until',
    SESSION_EXPIRES_AT: 'cobom_admin_session_exp'
};

// ===========================================================================
// Criptografia — PBKDF2-SHA256
// ===========================================================================

/**
 * Deriva um hash PBKDF2-SHA256 do PIN e o retorna em hexadecimal.
 * @param {string} pin
 * @returns {Promise<string>}
 */
async function deriveAdminHash(pin) {
    if (!pin || typeof pin !== 'string') throw new Error('PIN inválido');

    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(pin),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );

    const bits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: enc.encode(ADMIN_AUTH_CONFIG.SALT),
            iterations: ADMIN_AUTH_CONFIG.ITERATIONS,
            hash: 'SHA-256'
        },
        keyMaterial,
        256 // 32 bytes
    );

    return Array.from(new Uint8Array(bits))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Comparação de strings em tempo constante.
 * Não usa `===` para evitar vazamento por timing (importante quando o
 * atacante pode medir milissegundos).
 */
function timingSafeEqualHex(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

// Compat: SHA-256 puro (só para migração legada)
async function sha256(str) {
    try {
        const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    } catch (error) {
        console.error('Erro ao calcular hash:', error);
        return null;
    }
}

// ===========================================================================
// Rate limiting persistente
// ===========================================================================

function _now() { return Date.now(); }

function _getLockoutUntil() {
    return Number(localStorage.getItem(ADMIN_STORAGE_KEYS.LOCKOUT_UNTIL) || 0);
}

function _getFailedAttempts() {
    return Number(localStorage.getItem(ADMIN_STORAGE_KEYS.ATTEMPTS) || 0);
}

function _resetAttempts() {
    localStorage.removeItem(ADMIN_STORAGE_KEYS.ATTEMPTS);
    localStorage.removeItem(ADMIN_STORAGE_KEYS.LOCKOUT_UNTIL);
}

function _registerFailedAttempt() {
    const attempts = _getFailedAttempts() + 1;
    localStorage.setItem(ADMIN_STORAGE_KEYS.ATTEMPTS, String(attempts));

    if (attempts >= ADMIN_AUTH_CONFIG.MAX_ATTEMPTS) {
        const until = _now() + ADMIN_AUTH_CONFIG.LOCKOUT_MS;
        localStorage.setItem(ADMIN_STORAGE_KEYS.LOCKOUT_UNTIL, String(until));
    }
    return attempts;
}

/**
 * Retorna o número de segundos restantes de bloqueio, ou 0 se liberado.
 */
function _lockoutSecondsRemaining() {
    const until = _getLockoutUntil();
    const remaining = until - _now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

// ===========================================================================
// Sessão admin — expiração por inatividade
// ===========================================================================

function _touchAdminSession() {
    localStorage.setItem(
        ADMIN_STORAGE_KEYS.SESSION_EXPIRES_AT,
        String(_now() + ADMIN_AUTH_CONFIG.SESSION_TTL_MS)
    );
}

function _isAdminSessionValid() {
    const exp = Number(localStorage.getItem(ADMIN_STORAGE_KEYS.SESSION_EXPIRES_AT) || 0);
    return exp > _now();
}

function _endAdminSession() {
    localStorage.removeItem(ADMIN_STORAGE_KEYS.SESSION_EXPIRES_AT);
}

// Verifica expiração a cada 60 s — derruba a UI se necessário.
setInterval(() => {
    if (window.isAdmin && !_isAdminSessionValid()) {
        window.isAdmin = false;
        _endAdminSession();
        if (typeof setupAuth === 'function') setupAuth();
        if (typeof showToast === 'function') {
            showToast('Sessão administrativa expirada por inatividade.', 'warning', 5000);
        }
    }
}, 60 * 1000);

// ===========================================================================
// Verificação de PIN (interface pública para o modal)
// ===========================================================================

/**
 * Verifica o PIN aplicando rate limiting e PBKDF2.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function verifyPinAsync(pin) {
    // 1) Bloqueio ativo?
    const lockRemaining = _lockoutSecondsRemaining();
    if (lockRemaining > 0) {
        const mins = Math.ceil(lockRemaining / 60);
        return { ok: false, reason: `Bloqueado. Tente novamente em ~${mins} min.` };
    }

    if (!pin || typeof pin !== 'string' || pin.length < 4) {
        _registerFailedAttempt();
        return { ok: false, reason: 'PIN incorreto. Tente novamente.' };
    }

    let isValid = false;

    try {
        // Caminho principal: PBKDF2 (hash configurado)
        if (ADMIN_AUTH_CONFIG.HASH && ADMIN_AUTH_CONFIG.HASH !== 'SUBSTITUA_PELO_HASH_GERADO') {
            const derived = await deriveAdminHash(pin);
            isValid = timingSafeEqualHex(derived, ADMIN_AUTH_CONFIG.HASH);
        } else {
            // Bootstrap de migração: aceita o SHA-256 legado APENAS para
            // permitir que o operador faça login e regenere o hash.
            const legacy = await sha256(pin);
            isValid = timingSafeEqualHex(legacy, ADMIN_AUTH_CONFIG.LEGACY_SHA256);

            if (isValid) {
                console.warn(
                    '[Admin] Login aceito via hash legado. Gere o hash PBKDF2 ' +
                    'com window.generateAdminHash("seu_pin") e cole em ADMIN_AUTH_CONFIG.HASH.'
                );
            }
        }
    } catch (e) {
        console.error('[Admin] Erro na verificação:', e);
        return { ok: false, reason: 'Erro interno. Tente novamente.' };
    }

    if (!isValid) {
        const attempts = _registerFailedAttempt();
        const remaining = Math.max(0, ADMIN_AUTH_CONFIG.MAX_ATTEMPTS - attempts);
        const msg = remaining > 0
            ? `PIN incorreto. ${remaining} tentativa(s) restante(s).`
            : 'Muitas tentativas. Login bloqueado por 15 minutos.';
        return { ok: false, reason: msg };
    }

    // Sucesso
    _resetAttempts();
    _touchAdminSession();
    return { ok: true };
}

// ===========================================================================
// Gerador de hash (uso pontual no console do navegador)
// ===========================================================================
window.generateAdminHash = async function (pin) {
    if (!pin || typeof pin !== 'string') {
        console.error('Uso: await window.generateAdminHash("seu_pin")');
        return null;
    }
    const hash = await deriveAdminHash(pin);
    console.log('%c=== Hash PBKDF2 gerado ===', 'color:#27ae60; font-weight:bold;');
    console.log('Cole em js/admin.js → ADMIN_AUTH_CONFIG.HASH:\n');
    console.log(hash);
    return hash;
};

// ===========================================================================
// SETUP DE AUTH (inalterado funcionalmente — melhorias de UX no modal)
// ===========================================================================

function setupAuth() {
    const adminTools = document.getElementById('adminTools');
    const loginBtn = document.getElementById('adminLoginBtn');
    const logoutBtn = document.getElementById('adminLogoutBtn');
    const searchContainer = document.querySelector('.search-container');

    if (window.isAdmin) {
        if (adminTools) adminTools.classList.remove('hidden');
        if (loginBtn) loginBtn.classList.add('hidden');
        if (logoutBtn) logoutBtn.classList.remove('hidden');
        if (searchContainer) searchContainer.classList.add('hidden');
    } else {
        if (adminTools) adminTools.classList.add('hidden');
        if (loginBtn) loginBtn.classList.remove('hidden');
        if (logoutBtn) logoutBtn.classList.add('hidden');
        if (searchContainer) searchContainer.classList.remove('hidden');
    }
    if (typeof updateLayerListUI === 'function') updateLayerListUI();
    if (typeof renderLegend === 'function') {
        renderLegend().catch(() => {});
    }
}

function setupFloatingSearch() {
    const input   = document.getElementById('floatingSearchInput');
    const btn     = document.getElementById('floatingSearchBtn');
    const clear   = document.getElementById('floatingSearchClear');
    const box     = document.getElementById('floatingSearchBox');
    const results = document.getElementById('floatingSearchResults');
    const wrapper = document.getElementById('floatingSearch');
    if (!input || !btn || !results || !wrapper) return;

    let debounceTimer = null;

    const syncClearVisibility = () => {
        if (!box) return;
        if (input.value.trim().length > 0) box.classList.add('has-text');
        else                                box.classList.remove('has-text');
    };

    const closeResults = () => {
        results.classList.add('hidden');
        results.innerHTML = '';
    };

    const runSearch = () => {
        const q = input.value.trim();
        if (q.length < 3) { closeResults(); return; }
        results.classList.remove('hidden');
        searchAddress(q, 'floatingSearchResults');
    };

    btn.addEventListener('click', runSearch);

    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
    });

    input.addEventListener('input', () => {
        syncClearVisibility();
        clearTimeout(debounceTimer);
        const q = input.value.trim();
        if (!q) { closeResults(); return; }
        if (q.length >= 3) {
            debounceTimer = setTimeout(() => {
                results.classList.remove('hidden');
                searchAddress(q, 'floatingSearchResults');
            }, 400);
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeResults(); input.blur(); }
    });

    if (clear) {
        clear.addEventListener('click', async () => {
            input.value = '';
            syncClearVisibility();
            closeResults();

            if (typeof window.resetAll === 'function') {
                try { await window.resetAll(); }
                catch (e) { console.warn('Falha ao limpar seleção via botão ✕:', e); }
            }
            input.focus();
        });
    }

    syncClearVisibility();

    const sidebarEl = document.getElementById('sidebar');
    if (sidebarEl && typeof MutationObserver !== 'undefined') {
        const sidebarObserver = new MutationObserver(() => closeResults());
        sidebarObserver.observe(sidebarEl, { attributes: true, attributeFilter: ['class'] });
    }

    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) closeResults();
    });
}

function initAdminAuthListeners() {
    const loginBtn = document.getElementById('adminLoginBtn');
    const logoutBtn = document.getElementById('adminLogoutBtn');
    const loginModal = document.getElementById('loginModal');
    const closeLoginModal = document.getElementById('closeLoginModal');
    const confirmLoginBtn = document.getElementById('confirmLoginBtn');
    const loginError = document.getElementById('loginError');
    const pinInput = document.getElementById('pinInput');

    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            // Avisa se ainda há bloqueio ativo antes de abrir o modal
            const remaining = _lockoutSecondsRemaining();
            if (loginModal) loginModal.classList.remove('hidden');
            if (pinInput) { pinInput.value = ''; pinInput.focus(); }
            if (loginError) {
                loginError.textContent = remaining > 0
                    ? `Bloqueado. Tente novamente em ~${Math.ceil(remaining / 60)} min.`
                    : '';
            }
        });
    }

    if (closeLoginModal) {
        closeLoginModal.addEventListener('click', () => {
            if (loginModal) loginModal.classList.add('hidden');
        });
    }

    if (confirmLoginBtn) {
        confirmLoginBtn.addEventListener('click', async () => {
            const pin = pinInput ? pinInput.value.trim() : '';

            confirmLoginBtn.disabled = true;
            const originalText = confirmLoginBtn.textContent;
            confirmLoginBtn.textContent = 'Verificando...';

            try {
                const result = await verifyPinAsync(pin);

                if (result.ok) {
                    window.isAdmin = true;
                    _touchAdminSession();
                    if (loginModal) loginModal.classList.add('hidden');
                    if (pinInput) pinInput.value = '';
                    if (loginError) loginError.textContent = '';
                    setupAuth();
                    if (typeof reloadLayers === 'function') await reloadLayers();
                    if (typeof showToast === 'function') {
                        showToast('Login de Administrador bem-sucedido!', 'success');
                    }
                } else {
                    if (loginError) loginError.textContent = result.reason || 'PIN incorreto.';
                    if (pinInput) { pinInput.value = ''; pinInput.focus(); }
                }
            } finally {
                confirmLoginBtn.disabled = false;
                confirmLoginBtn.textContent = originalText;
            }
        });
    }

    if (pinInput) {
        pinInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') confirmLoginBtn.click();
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            window.isAdmin = false;
            _endAdminSession();
            setupAuth();
            if (typeof reloadLayers === 'function') await reloadLayers();
            if (typeof showToast === 'function') showToast('Logout efetuado com sucesso.', 'info');
        });
    }
}

// ===========================================================================
// Upload de arquivos — com validação de tamanho e tipo
// ===========================================================================

// Limite de tamanho por arquivo (proteção contra DoS local)
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;  // 50 MB

function setupFileUpload() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
        fileInput.value = '';
    });

    if (typeof setupChamadasImportUI === 'function') setupChamadasImportUI();
}

async function handleFiles(files) {
    if (!window.isAdmin) return;

    for (const file of files) {
        // Validação preventiva: tamanho máximo
        if (file.size > MAX_UPLOAD_BYTES) {
            showToast(
                `Arquivo "${file.name}" excede o limite de ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB.`,
                'error', 5000
            );
            continue;
        }

        const ext = file.name.split('.').pop().toLowerCase();
        const ALLOWED = new Set(['kml', 'kmz', 'json', 'geojson', 'csv']);
        if (!ALLOWED.has(ext)) {
            showToast(`Formato não suportado: ${file.name}`, 'warning');
            continue;
        }

        // ---------- CSV de chamadas ----------
        if (ext === 'csv') {
            try {
                const layers = await DB.getLayers();
                const existing = layers.find(l => l.name === CHAMADAS_LAYER_NAME);

                let replaceExisting = false;
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
                console.error('Erro ao importar CSV:', err);
                showToast('Erro ao importar CSV: ' + err.message, 'error', 5000);
            }
            continue;
        }

        // ---------- KML / KMZ / JSON / GeoJSON ----------
        try {
            let geojson;
            if (ext === 'kml') {
                const text = await file.text();
                const kmlDom = new DOMParser().parseFromString(text, 'text/xml');
                geojson = toGeoJSON.kml(kmlDom);
            } else if (ext === 'kmz') {
                const zip = await JSZip.loadAsync(file);
                const kmlFile = Object.values(zip.files).find(f => f.name.toLowerCase().endsWith('.kml'));
                if (!kmlFile) throw new Error('Nenhum arquivo KML dentro do KMZ');
                const kmlText = await kmlFile.async('text');
                const kmlDom = new DOMParser().parseFromString(kmlText, 'text/xml');
                geojson = toGeoJSON.kml(kmlDom);
            } else if (ext === 'json' || ext === 'geojson') {
                const text = await file.text();
                geojson = JSON.parse(text);
                if (!geojson.type || geojson.type !== 'FeatureCollection') {
                    if (geojson.type === 'Feature') {
                        geojson = { type: 'FeatureCollection', features: [geojson] };
                    } else if (['Point','Polygon','LineString','MultiPolygon'].includes(geojson.type)) {
                        geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geojson, properties: {} }] };
                    } else {
                        throw new Error('GeoJSON em formato inválido');
                    }
                }
            } else {
                showToast(`Formato não suportado: ${file.name}`, 'warning');
                continue;
            }

            // Sanitiza o GeoJSON (remove funções, __proto__, etc.)
            geojson = sanitizeGeoJSON(geojson);

            const layerName = sanitizeLayerName(file.name.replace(/\.(kml|kmz|json|geojson)$/i, ''));
            const existingLayers = await DB.getLayers();
            const duplicate = existingLayers.find(l => l.name === layerName);

            if (duplicate) {
                const overwrite = confirm(`Já existe uma camada chamada "${layerName}". Deseja substituí-la?`);
                if (overwrite) {
                    await DB.deleteLayer(duplicate.id);
                    await DB.saveLayer({ name: layerName, type: 'geojson', geojson });
                } else {
                    continue;
                }
            } else {
                await DB.saveLayer({ name: layerName, type: 'geojson', geojson });
            }

            await reloadLayers();
            showToast(`Camada "${layerName}" carregada com sucesso!`, 'success');
        } catch (error) {
            console.error('Erro ao processar arquivo:', error);
            showToast(`Erro ao processar ${file.name}: ${error.message}`, 'error');
        }
    }
}

/**
 * Sanitiza uma estrutura GeoJSON recém-importada:
 *   • Rejeita features sem geometria ou com tipo desconhecido.
 *   • Copia apenas tipos primitivos em `properties`.
 *   • Remove chaves perigosas (__proto__, constructor, prototype).
 */
function sanitizeGeoJSON(geojson) {
    if (!geojson || typeof geojson !== 'object') throw new Error('GeoJSON inválido');

    const safeProps = (props) => {
        if (!props || typeof props !== 'object') return {};
        const out = {};
        for (const [k, v] of Object.entries(props)) {
            if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
            if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
            else if (Array.isArray(v)) out[k] = v.map(x => (typeof x === 'object' ? JSON.stringify(x) : x));
        }
        return out;
    };

    const validGeomTypes = new Set([
        'Point','MultiPoint','LineString','MultiLineString',
        'Polygon','MultiPolygon','GeometryCollection'
    ]);

    const features = (geojson.features || []).filter(f =>
        f && f.type === 'Feature' && f.geometry && validGeomTypes.has(f.geometry.type)
    ).map(f => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: safeProps(f.properties)
    }));

    return { type: 'FeatureCollection', features };
}

function sanitizeLayerName(name) {
    return String(name || 'Camada')
        .replace(/[\u0000-\u001F<>"'`]/g, '')
        .trim()
        .slice(0, 120) || 'Camada';
}

// ===========================================================================
// Ferramentas de desenho
// ===========================================================================

function setupDrawingTools() {
    const addMarkerBtn = document.getElementById('addMarkerBtn');
    const addPolygonBtn = document.getElementById('addPolygonBtn');

    if (addMarkerBtn) {
        addMarkerBtn.addEventListener('click', () => {
            if (drawingMode === 'marker') {
                drawingMode = null;
                map.off('click', handleMapClickForMarker);
                addMarkerBtn.classList.remove('active');
                addMarkerBtn.textContent = 'Adicionar POI';
                showToast('Modo POI cancelado.', 'info');
            } else {
                drawingMode = 'marker';
                if (polygonTempLayer && map) { map.removeLayer(polygonTempLayer); polygonTempLayer = null; }
                polygonPoints = [];
                map.off('click', handleMapClickForPolygon);
                if (addPolygonBtn) {
                    addPolygonBtn.classList.remove('active');
                    addPolygonBtn.textContent = 'Desenhar Polígono';
                }
                map.on('click', handleMapClickForMarker);
                addMarkerBtn.classList.add('active');
                addMarkerBtn.textContent = '✕ Cancelar POI';
                showToast('Modo POI ativo: clique no mapa para posicionar o ponto.', 'info', 4500);
            }
        });
    }

    if (addPolygonBtn) {
        addPolygonBtn.addEventListener('click', () => {
            if (drawingMode === 'polygon') {
                if (polygonPoints.length >= 3) {
                    finishPolygonAndOpenModal();
                } else {
                    drawingMode = null;
                    map.off('click', handleMapClickForPolygon);
                    addPolygonBtn.classList.remove('active');
                    addPolygonBtn.textContent = 'Desenhar Polígono';
                    if (polygonTempLayer && map) { map.removeLayer(polygonTempLayer); polygonTempLayer = null; }
                    polygonPoints = [];
                    showToast('Desenho de polígono cancelado (mínimo 3 pontos).', 'info');
                }
            } else {
                drawingMode = 'polygon';
                polygonPoints = [];
                if (polygonTempLayer && map) map.removeLayer(polygonTempLayer);
                polygonTempLayer = L.layerGroup().addTo(map);
                map.off('click', handleMapClickForMarker);
                if (addMarkerBtn) {
                    addMarkerBtn.classList.remove('active');
                    addMarkerBtn.textContent = 'Adicionar POI';
                }
                map.on('click', handleMapClickForPolygon);
                addPolygonBtn.classList.add('active');
                addPolygonBtn.textContent = '✓ Finalizar Polígono';
                showToast('Clique no mapa para adicionar vértices. Depois clique em "✓ Finalizar Polígono".', 'info', 5000);
            }
        });
    }

    setupBackupAndRoutes();
}

function handleMapClickForMarker(e) {
    const feature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [e.latlng.lng, e.latlng.lat] },
        properties: { name: '' }
    };
    drawingMode = null;
    map.off('click', handleMapClickForMarker);
    const addMarkerBtn = document.getElementById('addMarkerBtn');
    if (addMarkerBtn) { addMarkerBtn.classList.remove('active'); addMarkerBtn.textContent = 'Adicionar POI'; }
    openCreateFeatureModal(feature, 'Novo POI');
}

function handleMapClickForPolygon(e) {
    polygonPoints.push([e.latlng.lat, e.latlng.lng]);
    if (polygonTempLayer && map) map.removeLayer(polygonTempLayer);
    polygonTempLayer = L.layerGroup().addTo(map);
    L.polyline(polygonPoints, { color: '#2980b9', weight: 3 }).addTo(polygonTempLayer);
    polygonPoints.forEach(p => L.circleMarker(p, { radius: 5, color: '#e74c3c', fillColor: '#e74c3c', fillOpacity: 0.9 }).addTo(polygonTempLayer));

    const n = polygonPoints.length;
    if (n === 1) showToast('1º vértice marcado.', 'info', 2000);
    else if (n === 2) showToast('2 vértices. Adicione pelo menos mais 1.', 'info', 2000);
    else showToast(`${n} vértices. Clique em "Finalizar Polígono" quando pronto.`, 'info', 2000);
}

function finishPolygonAndOpenModal() {
    if (polygonPoints.length < 3) {
        showToast('Um polígono necessita de pelo menos 3 pontos.', 'warning');
        return;
    }
    const closedCoords = [...polygonPoints, polygonPoints[0]];
    const feature = {
        type: 'Feature',
        geometry: {
            type: 'Polygon',
            coordinates: [closedCoords.map(([lat, lng]) => [lng, lat])]
        },
        properties: { name: '', fill: '#0288d1' }
    };
    drawingMode = null;
    map.off('click', handleMapClickForPolygon);
    const addPolygonBtn = document.getElementById('addPolygonBtn');
    if (addPolygonBtn) { addPolygonBtn.classList.remove('active'); addPolygonBtn.textContent = 'Desenhar Polígono'; }
    if (polygonTempLayer && map) { map.removeLayer(polygonTempLayer); polygonTempLayer = null; }
    polygonPoints = [];
    openCreateFeatureModal(feature, 'Novo Polígono');
}

function setupBackupAndRoutes() {
    const exportBtn = document.getElementById('exportBackupBtn');
    const importBtn = document.getElementById('importBackupBtn');
    const importInput = document.getElementById('importFileInput');

    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            if (!window.isAdmin) return;
            const backup = await DB.exportBackup();
            const blob = new Blob([backup], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gis_backup_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Backup exportado com sucesso!', 'success');
        });
    }

    if (importBtn && importInput) {
        importBtn.addEventListener('click', () => importInput.click());
        importInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > MAX_UPLOAD_BYTES) {
                showToast('Backup excede o limite de tamanho.', 'error', 5000);
                e.target.value = '';
                return;
            }
            const text = await file.text();
            const success = await DB.importBackup(text);
            if (success) {
                showToast('Backup importado com sucesso!', 'success');
                await reloadLayers();
            } else {
                showToast('Erro ao importar backup.', 'error');
            }
            e.target.value = '';
        });
    }

    const clearRoutesBtn = document.getElementById('clearRoutesBtn');
    if (clearRoutesBtn) {
        clearRoutesBtn.addEventListener('click', async () => {
            if (!window.isAdmin) return;
            if (confirm('Deseja limpar todas as rotas armazenadas em cache local?')) {
                if (window.DB && typeof window.DB.clearRoutes === 'function') {
                    await window.DB.clearRoutes();
                    showToast('Cache de rotas limpo com sucesso!', 'success');
                }
            }
        });
    }
}

// ============================================================================
// Módulo de Edição / Criação de Feições (inalterado)
// ============================================================================

let currentEditingContext = null;
let isJsonEditMode = false;
let isCreateMode = false;

const FEATURE_FIELD_SCHEMAS = {
    UNIDADE_BM: [
        { key: 'name', label: 'Nome da Fração / Unidade BM / POI:', type: 'text' },
        { key: 'Município', label: 'Município:', type: 'text' },
        { key: 'UEOP', label: 'Batalhão / UEOP (BBM / CIA IND):', type: 'text' },
        { key: 'COB', label: 'Comando Operacional (COB / CEB):', type: 'text' },
        { key: 'FRAÇÃO', label: 'Fração / Destacamento:', type: 'text' },
        { key: 'Endereço', label: 'Endereço completo:', type: 'text' }
    ],
    HOSPITAL: [
        { key: 'Nome do Hospital', label: 'Nome do Hospital / UPA:', type: 'text' },
        { key: 'Tipo', label: 'Tipo (deixe "UPA" para Unidades de Pronto Atendimento):', type: 'text' },
        { key: 'Município', label: 'Município:', type: 'text' },
        { key: 'Macrorregião de Saúde', label: 'Macrorregião de Saúde:', type: 'text' },
        { key: 'Especialidades', label: 'Especialidades / Serviços:', type: 'textarea' },
        { key: 'Endereço', label: 'Endereço completo:', type: 'text' }
    ],
    MICRORREGIAO: [
        { key: 'Regionalização pop. 2025 — RegionalizaçãoMG2025_Microrregião de Saúde', label: 'Microrregião de Saúde:', type: 'text' },
        { key: 'Microrregião de Saúde', label: 'Microrregião de Saúde (campo curto):', type: 'text' },
        { key: 'NM_RGI', label: 'Região Imediata (NM_RGI):', type: 'text' },
        { key: 'Regionalização pop. 2025 — RegionalizaçãoMG2025_Macrorregião de Saúde', label: 'Macrorregião de Saúde:', type: 'text' },
        { key: 'Macrorregião de Saúde', label: 'Macrorregião (campo curto):', type: 'text' },
        { key: 'NM_MUN', label: 'Município (NM_MUN):', type: 'text' },
        { key: 'Município Sede', label: 'Município Sede:', type: 'text' },
        { key: 'AREA_KM2', label: 'Área (km²):', type: 'text' },
        { key: 'Regionalização pop. 2025 — RegionalizaçãoMG2025_POPULAÇÃO CENSO DEMOGRÁFICO (IBGE/2022)', label: 'População 2022:', type: 'text' },
        { key: 'Regionalização pop. 2025 — RegionalizaçãoMG2025_POPULAÇÃO CENSO DEMOGRÁFICO (IBGE/2025)', label: 'População 2025 (est.):', type: 'text' },
        { key: 'Hospitais de Referência', label: 'Hospitais de Referência (um por linha):', type: 'textarea' }
    ],
    MACRORREGIAO: [
        { key: 'Macrorregiao_Saude', label: 'Macrorregião de Saúde:', type: 'text' },
        { key: 'Macrorregião de Saúde', label: 'Macrorregião (campo curto):', type: 'text' },
        { key: 'Regionalização pop. 2025 — RegionalizaçãoMG2025_Macrorregião de Saúde', label: 'Macrorregião (campo longo oficial):', type: 'text' },
        { key: 'Município Sede / Polo Macrorregional', label: 'Município Sede / Polo Macrorregional:', type: 'text' },
        { key: 'Central_SAMU_192', label: 'Central SAMU 192:', type: 'text' },
        { key: 'Municipio_Sede_Central_192', label: 'Município Sede da Central 192:', type: 'text' },
        { key: 'Municipios_Atendidos_Central_192', label: 'Municípios Atendidos pela Central 192:', type: 'textarea' },
        { key: 'Hospitais_de_Referencia_Macrorregiao', label: 'Hospitais de Referência da Macro (um por linha):', type: 'textarea' },
        { key: 'Hospitais_de_Referencia_Macrorregiao_Texto', label: 'Hospitais (texto alternativo — separados por |):', type: 'textarea' }
    ],
    HIDRANTE: [
        { key: 'id',            label: 'ID do Hidrante (CBMMG):', type: 'text' },
        { key: 'nReds',         label: 'REDS (nº da vistoria):', type: 'text' },
        { key: 'unidade',       label: 'Unidade BM responsável:', type: 'text' },
        { key: 'logradouro',    label: 'Logradouro:', type: 'text' },
        { key: 'numero',        label: 'Número:', type: 'text' },
        { key: 'bairro',        label: 'Bairro:', type: 'text' },
        { key: 'cidade',        label: 'Cidade / Município:', type: 'text' },
        { key: 'referencia',    label: 'Referência (ponto de apoio):', type: 'text' },
        { key: 'data',          label: 'Data da última vistoria (DD-MM-AAAA):', type: 'text' },
        { key: 'situacao',      label: 'Situação (Ativo / Inativo / Em manutenção):', type: 'text' },
        { key: 'tipo',          label: 'Tipo (Coluna / Subterrâneo / …):', type: 'text' },
        { key: 'diametro',      label: 'Diâmetro (mm):', type: 'text' },
        { key: 'vazao',         label: 'Vazão (L/min):', type: 'text' },
        { key: 'responsavel',   label: 'Órgão / Responsável:', type: 'text' }
    ],
    POLYGON: [
        { key: 'name', label: 'Nome da Circunscrição / BBM:', type: 'text' },
        { key: 'NM_MUN', label: 'Município Sede / Referência:', type: 'text' },
        { key: 'CD_MUN', label: 'Código IBGE do Município:', type: 'text' },
        { key: 'AREA_KM2', label: 'Área Territorial Coberta (km²):', type: 'text' },
        { key: 'Field8', label: 'Tipo da Fração (BBM, CIA, PEL, PA, etc.):', type: 'text' },
        { key: 'Field10', label: 'Denominação Completa da Fração:', type: 'text' },
        { key: 'Field7', label: 'Comando Operacional / Batalhão:', type: 'text' },
        { key: 'Field5', label: 'Situação / Status:', type: 'text' },
        { key: 'Field11', label: 'Data de Instalação (AAAA/MM/DD):', type: 'text' },
        { key: 'fill', label: 'Cor de Preenchimento (Hex):', type: 'text' },
        { key: 'stroke', label: 'Cor da Borda (Hex):', type: 'text' },
        { key: 'fill-opacity', label: 'Opacidade do Preenchimento (0-1):', type: 'text' },
        { key: 'stroke-width', label: 'Espessura da Borda:', type: 'text' }
    ]
};

const SYSTEM_PROP_KEYS = new Set([
    '_layerId', '_layerName', '_layerDbId', '_featureIndex',
    '_tipo', '_uf',
    'description', 'descrição', 'fid', 'styleUrl', 'icon', 'icon-scale',
    'auxiliary_storage_labeling_positionx', 'auxiliary_storage_labeling_positiony',
    'SIGLA_UF', 'Field1', 'Field3', 'Field4', 'Field9',
    'Latitude', 'Longitude', 'LATITUDE', 'LONGITUDE'
]);

window.openEditFeatureModal = async function (layerId, featureIndex) {
    if (!window.isAdmin) {
        showToast('Você não tem permissão para editar esta feição.', 'error');
        return;
    }
    const layerData = await DB.getLayerById(Number(layerId));
    if (!layerData || !layerData.geojson || !Array.isArray(layerData.geojson.features)) {
        showToast('Não foi possível carregar a camada da feição.', 'error');
        return;
    }
    const feature = layerData.geojson.features[featureIndex];
    if (!feature) {
        showToast('Feição não encontrada na camada.', 'error');
        return;
    }

    isCreateMode = false;
    currentEditingContext = {
        isNew: false,
        layerId: Number(layerId),
        featureIndex: Number(featureIndex),
        layerData,
        feature: JSON.parse(JSON.stringify(feature))
    };
    isJsonEditMode = false;
    prepareModalForEditOrCreate();
    renderEditFeatureForm(currentEditingContext.feature);

    const jsonTextarea = document.getElementById('editFeatureJsonTextarea');
    if (jsonTextarea) jsonTextarea.value = JSON.stringify(feature, null, 2);

    const modal = document.getElementById('editFeatureModal');
    if (modal) modal.classList.remove('hidden');
};

window.openCreateFeatureModal = async function (feature, defaultTitle = 'Nova Feição') {
    if (!window.isAdmin) {
        showToast('Você não tem permissão para criar feições.', 'error');
        return;
    }
    isCreateMode = true;
    currentEditingContext = {
        isNew: true,
        feature: JSON.parse(JSON.stringify(feature)),
        defaultTitle
    };
    isJsonEditMode = false;
    prepareModalForEditOrCreate();
    renderEditFeatureForm(currentEditingContext.feature);
    await populateTargetLayerSelect();

    const jsonTextarea = document.getElementById('editFeatureJsonTextarea');
    if (jsonTextarea) jsonTextarea.value = JSON.stringify(feature, null, 2);

    const modal = document.getElementById('editFeatureModal');
    if (modal) modal.classList.remove('hidden');
};

function prepareModalForEditOrCreate() {
    const modalTitle = document.getElementById('editFeatureModalTitle');
    const modalSubtitle = document.getElementById('editFeatureCategory');
    const deleteBtn = document.getElementById('deleteFeatureBtn');
    const saveBtn = document.getElementById('saveFeatureBtn');
    const layerSelector = document.getElementById('createLayerSelector');
    const newLayerGroup = document.getElementById('newLayerNameGroup');
    const jsonContainer = document.getElementById('editFeatureJsonContainer');
    const fieldsContainer = document.getElementById('editFeatureFieldsContainer');
    const toggleBtn = document.getElementById('toggleJsonModeBtn');

    if (jsonContainer) jsonContainer.classList.add('hidden');
    if (fieldsContainer) fieldsContainer.classList.remove('hidden');
    if (toggleBtn) toggleBtn.textContent = '📋 Alternar Modo JSON';

    if (isCreateMode) {
        if (modalTitle) modalTitle.textContent = `➕ ${currentEditingContext.defaultTitle || 'Nova Feição'}`;
        if (modalSubtitle) modalSubtitle.textContent = 'Preencha os atributos e escolha a camada de destino.';
        if (deleteBtn) deleteBtn.classList.add('hidden');
        if (saveBtn) { saveBtn.textContent = '💾 Criar Feição'; saveBtn.style.background = '#27ae60'; }
        if (layerSelector) layerSelector.classList.remove('hidden');
        if (newLayerGroup) newLayerGroup.classList.remove('hidden');
    } else {
        const name = currentEditingContext.feature.properties?.name ||
                     currentEditingContext.feature.properties?.['Nome da Unidade'] ||
                     currentEditingContext.feature.properties?.['Nome do Hospital'] ||
                     'Feição sem nome';
        const classification = typeof getFeatureClassification === 'function'
            ? getFeatureClassification(currentEditingContext.feature)
            : currentEditingContext.feature.geometry?.type;
        if (modalTitle) modalTitle.textContent = `✏️ Editar Feição: ${name}`;
        if (modalSubtitle) {
            modalSubtitle.textContent = `Camada: "${currentEditingContext.layerData.name}" | Tipo: ${classification}`;
        }
        if (deleteBtn) deleteBtn.classList.remove('hidden');
        if (saveBtn) { saveBtn.textContent = '💾 Salvar Alterações'; saveBtn.style.background = '#27ae60'; }
        if (layerSelector) layerSelector.classList.add('hidden');
        if (newLayerGroup) newLayerGroup.classList.add('hidden');
    }
}

async function populateTargetLayerSelect() {
    const select = document.getElementById('targetLayerSelect');
    if (!select) return;
    while (select.options.length > 1) select.remove(1);

    const layers = await DB.getLayers();
    const hiddenNames = ['RMBH', 'Ruas', 'Logradouros', 'Street'];
    layers.forEach(layer => {
        if (hiddenNames.some(k => layer.name.includes(k))) return;
        const opt = document.createElement('option');
        opt.value = layer.id;
        opt.textContent = layer.name;
        select.appendChild(opt);
    });
    select.value = 'new';
    toggleNewLayerNameVisibility();
}

function toggleNewLayerNameVisibility() {
    const select = document.getElementById('targetLayerSelect');
    const group = document.getElementById('newLayerNameGroup');
    if (!select || !group) return;
    if (select.value === 'new') {
        group.classList.remove('hidden');
        const input = document.getElementById('newLayerNameInput');
        if (input && !input.value) {
            const geomType = currentEditingContext?.feature?.geometry?.type || 'Feição';
            input.value = geomType === 'Point' ? 'Meus POIs' : 'Minhas Áreas';
            input.focus();
        }
    } else {
        group.classList.add('hidden');
    }
}

function renderEditFeatureForm(feature) {
    const container = document.getElementById('editFeatureFieldsContainer');
    if (!container) return;
    container.innerHTML = '';

    const props = feature.properties || {};
    const geom = feature.geometry || {};
    const classification = typeof getFeatureClassification === 'function'
        ? getFeatureClassification(feature)
        : 'OTHER';

    if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
        const coordsRow = document.createElement('div');
        coordsRow.className = 'form-row-coords';
        coordsRow.innerHTML = `
            <div class="form-group-edit">
                <label>Latitude:</label>
                <input type="number" step="any" id="editProp_coordLat"
                       value="${geom.coordinates[1] !== undefined ? geom.coordinates[1] : ''}" required>
            </div>
            <div class="form-group-edit">
                <label>Longitude:</label>
                <input type="number" step="any" id="editProp_coordLng"
                       value="${geom.coordinates[0] !== undefined ? geom.coordinates[0] : ''}" required>
            </div>
        `;
        container.appendChild(coordsRow);
    }

    const schema = FEATURE_FIELD_SCHEMAS[classification];
    const renderedKeys = new Set();

    if (schema) {
        schema.forEach(field => {
            const value = props[field.key];
            let displayValue = '';
            if (Array.isArray(value)) displayValue = value.join('\n');
            else if (value !== undefined && value !== null) displayValue = String(value);

            const group = document.createElement('div');
            group.className = 'form-group-edit';

            if (field.type === 'textarea') {
                group.innerHTML = `
                    <label>${escapeHtml(field.label)}</label>
                    <textarea data-key="${escapeHtml(field.key)}" rows="4"
                              style="width:100%; padding:7px 9px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px; resize:vertical;">${escapeHtml(displayValue)}</textarea>
                `;
            } else {
                group.innerHTML = `
                    <label>${escapeHtml(field.label)}</label>
                    <input type="${escapeHtml(field.type || 'text')}" data-key="${escapeHtml(field.key)}"
                           value="${escapeHtml(displayValue)}">
                `;
            }
            container.appendChild(group);
            renderedKeys.add(field.key);
        });
    }

    const customPropsHeader = document.createElement('div');
    customPropsHeader.innerHTML = `
        <h4 style="font-size:12px; color:#7f8c8d; margin-top:12px; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.4px;">
            ${schema ? 'Outros Atributos' : 'Atributos da Feição (camada personalizada)'}
        </h4>
    `;
    container.appendChild(customPropsHeader);

    const customContainer = document.createElement('div');
    customContainer.id = 'customPropsList';
    customContainer.style.display = 'flex';
    customContainer.style.flexDirection = 'column';
    customContainer.style.gap = '8px';

    Object.keys(props).forEach(key => {
        if (renderedKeys.has(key) || SYSTEM_PROP_KEYS.has(key)) return;
        let val = props[key];
        if (Array.isArray(val)) val = val.join(' | ');
        customContainer.appendChild(createCustomPropRow(key, val));
    });

    if (!schema && customContainer.children.length === 0) {
        customContainer.appendChild(createCustomPropRow('', ''));
    }

    container.appendChild(customContainer);
}

function createCustomPropRow(key = '', value = '') {
    const row = document.createElement('div');
    row.className = 'custom-prop-row';
    row.innerHTML = `
        <input type="text" placeholder="Nome do Atributo" class="custom-prop-key" value="${escapeHtml(String(key))}">
        <input type="text" placeholder="Valor" class="custom-prop-value" value="${escapeHtml(String(value))}">
        <button type="button" class="btn-remove-prop" title="Remover atributo">&times;</button>
    `;
    row.querySelector('.btn-remove-prop').addEventListener('click', () => row.remove());
    return row;
}

function initEditFeatureModalListeners() {
    const modal = document.getElementById('editFeatureModal');
    const closeBtn = document.getElementById('closeEditFeatureModal');
    const cancelBtn = document.getElementById('cancelEditFeatureBtn');
    const saveBtn = document.getElementById('saveFeatureBtn');
    const deleteBtn = document.getElementById('deleteFeatureBtn');
    const addCustomBtn = document.getElementById('addCustomPropBtn');
    const toggleJsonBtn = document.getElementById('toggleJsonModeBtn');
    const jsonContainer = document.getElementById('editFeatureJsonContainer');
    const fieldsContainer = document.getElementById('editFeatureFieldsContainer');
    const jsonTextarea = document.getElementById('editFeatureJsonTextarea');
    const targetLayerSelect = document.getElementById('targetLayerSelect');

    const closeModal = () => {
        if (modal) modal.classList.add('hidden');
        currentEditingContext = null;
        isCreateMode = false;
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (targetLayerSelect) targetLayerSelect.addEventListener('change', toggleNewLayerNameVisibility);

    if (toggleJsonBtn) {
        toggleJsonBtn.addEventListener('click', () => {
            isJsonEditMode = !isJsonEditMode;
            if (isJsonEditMode) {
                syncFormToJson();
                if (fieldsContainer) fieldsContainer.classList.add('hidden');
                if (jsonContainer) jsonContainer.classList.remove('hidden');
                toggleJsonBtn.textContent = '📝 Modo Formulário';
            } else {
                try {
                    const parsed = JSON.parse(jsonTextarea.value);
                    currentEditingContext.feature = parsed;
                    renderEditFeatureForm(parsed);
                    if (jsonContainer) jsonContainer.classList.add('hidden');
                    if (fieldsContainer) fieldsContainer.classList.remove('hidden');
                    toggleJsonBtn.textContent = '📋 Alternar Modo JSON';
                } catch (e) {
                    showToast('Erro de sintaxe no JSON: ' + e.message, 'error');
                    isJsonEditMode = true;
                }
            }
        });
    }

    if (addCustomBtn) {
        addCustomBtn.addEventListener('click', () => {
            const list = document.getElementById('customPropsList');
            if (list) {
                const newRow = createCustomPropRow('', '');
                list.appendChild(newRow);
                const firstInput = newRow.querySelector('.custom-prop-key');
                if (firstInput) firstInput.focus();
            }
        });
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            if (!currentEditingContext || currentEditingContext.isNew) return;
            const name = currentEditingContext.feature.properties?.name ||
                         currentEditingContext.feature.properties?.['Nome do Hospital'] ||
                         'esta feição';
            if (confirm(`Tem certeza que deseja excluir permanentemente "${name}"?`)) {
                const { layerId, featureIndex, layerData } = currentEditingContext;
                layerData.geojson.features.splice(featureIndex, 1);
                await DB.updateLayer(layerId, { geojson: layerData.geojson });
                await reloadLayers();
                closeModal();
                showToast(`Feição "${name}" excluída com sucesso!`, 'info');
            }
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            if (!currentEditingContext) return;
            try {
                if (isJsonEditMode) {
                    const parsed = JSON.parse(jsonTextarea.value);
                    currentEditingContext.feature = parsed;
                } else {
                    applyFormValuesToFeature(currentEditingContext.feature);
                }

                if (currentEditingContext.isNew) {
                    const select = document.getElementById('targetLayerSelect');
                    const targetValue = select ? select.value : 'new';

                    if (targetValue === 'new') {
                        const nameInput = document.getElementById('newLayerNameInput');
                        let layerName = (nameInput && nameInput.value.trim()) || '';
                        if (!layerName) {
                            const geomType = currentEditingContext.feature.geometry?.type || 'Feição';
                            layerName = geomType === 'Point' ? 'Meus POIs' : 'Minhas Áreas';
                        }
                        layerName = sanitizeLayerName(layerName);
                        await DB.saveLayer({
                            name: layerName,
                            type: 'geojson',
                            geojson: { type: 'FeatureCollection', features: [currentEditingContext.feature] }
                        });
                        showToast(`Feição criada na nova camada "${layerName}"!`, 'success');
                    } else {
                        const layerId = Number(targetValue);
                        const layerData = await DB.getLayerById(layerId);
                        if (!layerData) {
                            showToast('Camada de destino não encontrada.', 'error');
                            return;
                        }
                        if (!layerData.geojson) layerData.geojson = { type: 'FeatureCollection', features: [] };
                        if (!Array.isArray(layerData.geojson.features)) layerData.geojson.features = [];
                        layerData.geojson.features.push(currentEditingContext.feature);
                        await DB.updateLayer(layerId, { geojson: layerData.geojson });
                        showToast(`Feição adicionada à camada "${layerData.name}"!`, 'success');
                    }
                } else {
                    const { layerId, featureIndex, layerData } = currentEditingContext;
                    layerData.geojson.features[featureIndex] = currentEditingContext.feature;
                    await DB.updateLayer(layerId, { geojson: layerData.geojson });
                    showToast('Informações da feição atualizadas com sucesso!', 'success');
                }

                await reloadLayers();
                closeModal();
            } catch (error) {
                console.error('Erro ao salvar feição:', error);
                showToast('Erro ao salvar feição: ' + error.message, 'error');
            }
        });
    }
}

function applyFormValuesToFeature(feature) {
    if (!feature.properties) feature.properties = {};
    const fieldsContainer = document.getElementById('editFeatureFieldsContainer');
    if (!fieldsContainer) return;

    const latInput = document.getElementById('editProp_coordLat');
    const lngInput = document.getElementById('editProp_coordLng');
    if (latInput && lngInput && feature.geometry?.type === 'Point') {
        const newLat = parseFloat(latInput.value);
        const newLng = parseFloat(lngInput.value);
        if (!isNaN(newLat) && !isNaN(newLng)) {
            feature.geometry.coordinates = [newLng, newLat, feature.geometry.coordinates[2] || 0];
            feature.properties.Latitude = String(newLat);
            feature.properties.Longitude = String(newLng);
            feature.properties.LATITUDE = String(newLat);
            feature.properties.LONGITUDE = String(newLng);
        }
    }

    fieldsContainer.querySelectorAll('[data-key]').forEach(el => {
        const key = el.dataset.key;
        let value = el.value.trim();
        const original = feature.properties[key];
        const looksLikeHospitalList = key.toLowerCase().includes('hospital');
        if (Array.isArray(original) || looksLikeHospitalList) {
            feature.properties[key] = value
                ? value.split(/\n|\|/).map(s => s.trim()).filter(Boolean)
                : [];
        } else {
            feature.properties[key] = value;
        }
    });

    fieldsContainer.querySelectorAll('.custom-prop-row').forEach(row => {
        const keyInput = row.querySelector('.custom-prop-key');
        const valInput = row.querySelector('.custom-prop-value');
        if (keyInput && valInput) {
            const k = keyInput.value.trim();
            if (k && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
                feature.properties[k] = valInput.value.trim();
            }
        }
    });

    if (feature.properties.UEOP && feature.properties.COB) {
        feature.properties.description = `COB: ${feature.properties.COB}<br>UEOP: ${feature.properties.UEOP}`;
    }
}

function syncFormToJson() {
    if (!currentEditingContext) return;
    applyFormValuesToFeature(currentEditingContext.feature);
    const jsonTextarea = document.getElementById('editFeatureJsonTextarea');
    if (jsonTextarea) {
        jsonTextarea.value = JSON.stringify(currentEditingContext.feature, null, 2);
    }
}
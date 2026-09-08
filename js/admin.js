// js/admin.js - Autenticação por PIN fixo + upload + ferramentas de desenho

// Hash fixo do PIN "cobom193"
const ADMIN_PIN_HASH = 'ffcbf6cc4c1b3280189888f5c15ae08b696d36b898224685586db93f0e9b34eb';

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
    updateLayerListUI();
}

async function sha256(str) {
    try {
        const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        const hashArray = Array.from(new Uint8Array(buffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (error) {
        console.error('Erro ao calcular hash:', error);
        return null;
    }
}

async function verifyPinAsync(pin) {
    const hash = await sha256(pin);
    return hash === ADMIN_PIN_HASH;
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
            if (loginModal) loginModal.classList.remove('hidden');
            if (pinInput) {
                pinInput.value = '';
                pinInput.focus();
            }
            if (loginError) loginError.textContent = '';
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
            const success = await verifyPinAsync(pin);
            if (success) {
                window.isAdmin = true;
                if (loginModal) loginModal.classList.add('hidden');
                if (pinInput) pinInput.value = '';
                if (loginError) loginError.textContent = '';
                setupAuth();
                await reloadLayers();
                showToast('Login de Administrador bem-sucedido!', 'success');
            } else {
                if (loginError) loginError.textContent = 'PIN incorreto. Tente novamente.';
                if (pinInput) {
                    pinInput.value = '';
                    pinInput.focus();
                }
            }
        });
    }

    // Enter no campo de PIN
    if (pinInput) {
        pinInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                confirmLoginBtn.click();
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            window.isAdmin = false;
            setupAuth();
            await reloadLayers();
            showToast('Logout efetuado com sucesso.', 'info');
        });
    }
}

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
}

async function handleFiles(files) {
    if (!window.isAdmin) return;
    for (const file of files) {
        try {
            let geojson;
            const ext = file.name.split('.').pop().toLowerCase();

            if (ext === 'kml') {
                const text = await file.text();
                const kmlDom = new DOMParser().parseFromString(text, 'text/xml');
                geojson = toGeoJSON.kml(kmlDom);
            } else if (ext === 'kmz') {
                const zip = await JSZip.loadAsync(file);
                const kmlFile = Object.values(zip.files).find(f => f.name.toLowerCase().endsWith('.kml'));
                if (!kmlFile) throw new Error('Nenhum arquivo KML encontrado dentro do KMZ');
                const kmlText = await kmlFile.async('text');
                const kmlDom = new DOMParser().parseFromString(kmlText, 'text/xml');
                geojson = toGeoJSON.kml(kmlDom);
            } else if (ext === 'json' || ext === 'geojson') {
                const text = await file.text();
                geojson = JSON.parse(text);
                if (!geojson.type || geojson.type !== 'FeatureCollection') {
                    if (geojson.type === 'Feature') {
                        geojson = { type: 'FeatureCollection', features: [geojson] };
                    } else if (['Point', 'Polygon', 'LineString', 'MultiPolygon'].includes(geojson.type)) {
                        geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geojson, properties: {} }] };
                    } else {
                        throw new Error('GeoJSON em formato inválido');
                    }
                }
            } else {
                showToast(`Formato não suportado: ${file.name}`, 'warning');
                continue;
            }

            const layerName = file.name.replace(/\.(kml|kmz|json|geojson)$/i, '');
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
                if (polygonTempLayer && map) {
                    map.removeLayer(polygonTempLayer);
                    polygonTempLayer = null;
                }
                polygonPoints = [];
                map.off('click', handleMapClickForPolygon);
                if (addPolygonBtn) {
                    addPolygonBtn.classList.remove('active');
                    addPolygonBtn.textContent = 'Desenhar Polígono';
                }
                map.on('click', handleMapClickForMarker);
                addMarkerBtn.classList.add('active');
                addMarkerBtn.textContent = '✕ Cancelar POI';
                showToast('📍 Modo POI ativo: clique no mapa para posicionar o ponto.', 'info', 4500);
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
                    if (polygonTempLayer && map) {
                        map.removeLayer(polygonTempLayer);
                        polygonTempLayer = null;
                    }
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
                showToast('🗺️ Clique no mapa para adicionar vértices. Depois clique em "✓ Finalizar Polígono".', 'info', 5000);
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
    if (addMarkerBtn) {
        addMarkerBtn.classList.remove('active');
        addMarkerBtn.textContent = 'Adicionar POI';
    }
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
    else showToast(`${n} vértices. Clique em "✓ Finalizar Polígono" quando pronto.`, 'info', 2000);
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
    if (addPolygonBtn) {
        addPolygonBtn.classList.remove('active');
        addPolygonBtn.textContent = 'Desenhar Polígono';
    }
    if (polygonTempLayer && map) {
        map.removeLayer(polygonTempLayer);
        polygonTempLayer = null;
    }
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
    // Botão de limpar cache de rotas removido
}

// ==========================================================================
// Módulo de Edição / Criação de Feições
// ==========================================================================

let currentEditingContext = null;
let isJsonEditMode = false;
let isCreateMode = false;

// ==========================================================================
// Schemas de campos por classificação de feição
// ==========================================================================
const FEATURE_FIELD_SCHEMAS = {
    UNIDADE_BM: [
        { key: 'name', label: 'Nome da Fração / Unidade BM / POI:', type: 'text' },
        { key: 'UEOP', label: 'Batalhão / UEOP de Vinculação:', type: 'text' },
        { key: 'COB', label: 'Comando Operacional (COB):', type: 'text' },
        { key: 'FRAÇÃO', label: 'Fração / Destacamento:', type: 'text' },
        { key: 'Tempo-resposta', label: 'Tempo-Resposta:', type: 'text' },
        { key: 'Zona de Quente', label: 'Zona de Risco / Quente:', type: 'text' }
    ],
    HOSPITAL: [
        { key: 'Nome do Hospital', label: 'Nome do Hospital:', type: 'text' },
        { key: 'Município', label: 'Município:', type: 'text' },
        { key: 'Macrorregião de Saúde', label: 'Macrorregião de Saúde:', type: 'text' }
    ],
    MICRORREGIAO: [
        { key: 'Regionalização pop. 2025 — RegionalizaçãoMG2025_Microrregião de Saúde', label: 'Microrregião de Saúde:', type: 'text' },
        { key: 'NM_RGI', label: 'Nome da Microrregião (NM_RGI):', type: 'text' },
        { key: 'Regionalização pop. 2025 — RegionalizaçãoMG2025_Macrorregião de Saúde', label: 'Macrorregião de Saúde:', type: 'text' },
        { key: 'NM_MUN', label: 'Município sede:', type: 'text' },
        { key: 'AREA_KM2', label: 'Área (km²):', type: 'text' },
        { key: 'Regionalização pop. 2025 — RegionalizaçãoMG2025_POPULAÇÃO CENSO DEMOGRÁFICO (IBGE/2022)', label: 'População 2022:', type: 'text' },
        { key: 'Regionalização pop. 2025 — RegionalizaçãoMG2025_POPULAÇÃO CENSO DEMOGRÁFICO (IBGE/2025)', label: 'População 2025 (est.):', type: 'text' },
        { key: 'Hospitais de Referência', label: 'Hospitais de Referência (um por linha):', type: 'textarea' }
    ],
    MACRORREGIAO: [
        { key: 'Macrorregiao_Saude', label: 'Macrorregião de Saúde:', type: 'text' },
        { key: 'Regionalização pop. 2025 — RegionalizaçãoMG2025_Macrorregião de Saúde', label: 'Macrorregião (campo longo):', type: 'text' },
        { key: 'Hospitais_de_Referencia_Macrorregiao', label: 'Hospitais de Referência da Macro (um por linha):', type: 'textarea' },
        { key: 'Hospitais_de_Referencia_Macrorregiao_Texto', label: 'Hospitais (texto alternativo):', type: 'textarea' }
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

// Chaves de sistema que nunca devem aparecer no formulário de edição
const SYSTEM_PROP_KEYS = new Set([
    '_layerId', '_layerName', '_layerDbId', '_featureIndex',
    'description', 'descrição', 'fid', 'styleUrl', 'icon', 'icon-scale',
    'auxiliary_storage_labeling_positionx', 'auxiliary_storage_labeling_positiony',
    'SIGLA_UF', 'Field1', 'Field3', 'Field4', 'Field9',
    'Latitude', 'Longitude', 'LATITUDE', 'LONGITUDE' // coordenadas têm inputs próprios
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
        if (saveBtn) {
            saveBtn.textContent = '💾 Criar Feição';
            saveBtn.style.background = '#27ae60';
        }
        if (layerSelector) layerSelector.classList.remove('hidden');
        if (newLayerGroup) newLayerGroup.classList.remove('hidden');
    } else {
        const name = currentEditingContext.feature.properties?.name ||
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
        if (saveBtn) {
            saveBtn.textContent = '💾 Salvar Alterações';
            saveBtn.style.background = '#27ae60';
        }
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

/**
 * Renderiza o formulário de edição/criação de forma adaptativa
 * conforme a classificação da feição (ou genérico para camadas customizadas).
 */
function renderEditFeatureForm(feature) {
    const container = document.getElementById('editFeatureFieldsContainer');
    if (!container) return;
    container.innerHTML = '';

    const props = feature.properties || {};
    const geom = feature.geometry || {};
    const classification = typeof getFeatureClassification === 'function'
        ? getFeatureClassification(feature)
        : 'OTHER';

    // ---- Coordenadas (apenas pontos) ----
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

    // ---- Schema específico ou genérico ----
    const schema = FEATURE_FIELD_SCHEMAS[classification];
    const renderedKeys = new Set();

    if (schema) {
        // Formulário especializado
        schema.forEach(field => {
            const value = props[field.key];
            let displayValue = '';

            if (Array.isArray(value)) {
                displayValue = value.join('\n');
            } else if (value !== undefined && value !== null) {
                displayValue = String(value);
            }

            const group = document.createElement('div');
            group.className = 'form-group-edit';

            if (field.type === 'textarea') {
                group.innerHTML = `
                    <label>${field.label}</label>
                    <textarea data-key="${field.key}" rows="4"
                              style="width:100%; padding:7px 9px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px; resize:vertical;">${escapeHtml(displayValue)}</textarea>
                `;
            } else {
                group.innerHTML = `
                    <label>${field.label}</label>
                    <input type="${field.type || 'text'}" data-key="${field.key}"
                           value="${escapeHtml(displayValue)}">
                `;
            }
            container.appendChild(group);
            renderedKeys.add(field.key);
        });
    }

    // ---- Outros atributos (sempre, para não perder dados) ----
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

        // Arrays que não estavam no schema principal
        let val = props[key];
        if (Array.isArray(val)) val = val.join(' | ');

        customContainer.appendChild(createCustomPropRow(key, val));
    });

    // Se for genérico e não houver nenhum atributo, deixa um placeholder
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

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
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

/**
 * Aplica os valores do formulário de volta na feição.
 * Trata textareas de arrays (um item por linha).
 */
function applyFormValuesToFeature(feature) {
    if (!feature.properties) feature.properties = {};
    const fieldsContainer = document.getElementById('editFeatureFieldsContainer');
    if (!fieldsContainer) return;

    // Coordenadas de ponto
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

    // Campos com data-key (inputs e textareas do schema)
    fieldsContainer.querySelectorAll('[data-key]').forEach(el => {
        const key = el.dataset.key;
        let value = el.value.trim();

        // Detecta se o campo original era array (hospitais) ou se o nome sugere lista
        const original = feature.properties[key];
        const looksLikeHospitalList = key.toLowerCase().includes('hospital');
        if (Array.isArray(original) || looksLikeHospitalList) {
            // Converte linhas (ou | ) em array
            feature.properties[key] = value
                ? value.split(/\n|\|/).map(s => s.trim()).filter(Boolean)
                : [];
        } else {
            feature.properties[key] = value;
        }
    });

    // Propriedades customizadas (chave/valor livres)
    fieldsContainer.querySelectorAll('.custom-prop-row').forEach(row => {
        const keyInput = row.querySelector('.custom-prop-key');
        const valInput = row.querySelector('.custom-prop-value');
        if (keyInput && valInput) {
            const k = keyInput.value.trim();
            if (k) feature.properties[k] = valInput.value.trim();
        }
    });

    // Mantém compatibilidade com description legada
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
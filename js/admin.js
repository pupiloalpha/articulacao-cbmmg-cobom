// js/admin.js - Autenticação por PIN, upload de KML/KMZ/GeoJSON, backup e ferramentas de desenho

// Configura estado visual e botões da seção administrativa
// Configura estado visual e botões da seção administrativa
function setupAuth() {
    const adminTools = document.getElementById('adminTools');
    const loginBtn = document.getElementById('adminLoginBtn');
    const logoutBtn = document.getElementById('adminLogoutBtn');
    const searchContainer = document.querySelector('.search-container');

    if (window.isAdmin) {
        if (adminTools) adminTools.classList.remove('hidden');
        if (loginBtn) loginBtn.classList.add('hidden');
        if (logoutBtn) logoutBtn.classList.remove('hidden');
        // Oculta a área de busca operacional quando administrador
        if (searchContainer) searchContainer.classList.add('hidden');
    } else {
        if (adminTools) adminTools.classList.add('hidden');
        if (loginBtn) loginBtn.classList.remove('hidden');
        if (logoutBtn) logoutBtn.classList.add('hidden');
        // Restaura a área de busca quando sai do modo admin
        if (searchContainer) searchContainer.classList.remove('hidden');
    }
    updateLayerListUI();
}

// Hash SHA-256 em hexadecimal
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

// Verifica o PIN fornecido contra o hash salvo no localStorage
async function verifyPinAsync(pin) {
    const storedHash = localStorage.getItem('adminPinHash');
    if (!storedHash) {
        const newHash = await sha256(pin);
        if (newHash) {
            localStorage.setItem('adminPinHash', newHash);
            adminPinHash = newHash;
            return true;
        }
        return false;
    }
    const hash = await sha256(pin);
    return hash === storedHash;
}

// Configurações e listeners para Login/Logout Admin
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
        });
    }

    if (closeLoginModal) {
        closeLoginModal.addEventListener('click', () => {
            if (loginModal) loginModal.classList.add('hidden');
        });
    }

    if (confirmLoginBtn) {
        confirmLoginBtn.addEventListener('click', async () => {
            const pin = pinInput.value.trim();
            const success = await verifyPinAsync(pin);
            if (success) {
                window.isAdmin = true;
                if (loginModal) loginModal.classList.add('hidden');
                pinInput.value = '';
                if (loginError) loginError.textContent = '';
                setupAuth();
                await reloadLayers();
                showToast('Login de Administrador bem-sucedido!', 'success');
            } else {
                if (loginError) loginError.textContent = 'PIN incorreto. Tente novamente.';
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

// Configuração do Upload de Arquivos (Drag and Drop / Seleção)
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
        const files = e.dataTransfer.files;
        handleFiles(files);
    });
    
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
        fileInput.value = '';
    });
}

// Processa arquivos KML, KMZ e GeoJSON
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
                    } else if (geojson.type === 'Point' || geojson.type === 'Polygon' || geojson.type === 'LineString') {
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
                    await DB.saveLayer({ name: layerName, type: 'geojson', geojson: geojson });
                } else {
                    continue;
                }
            } else {
                await DB.saveLayer({ name: layerName, type: 'geojson', geojson: geojson });
            }

            await reloadLayers();
            showToast(`Camada "${layerName}" carregada com sucesso!`, 'success');
        } catch (error) {
            console.error('Erro ao processar arquivo:', error);
            showToast(`Erro ao processar ${file.name}: ${error.message}`, 'error');
        }
    }
}

// ==========================================================================
// Ferramentas de Desenho (POI e Polígonos) - MELHORADAS
// ==========================================================================

function setupDrawingTools() {
    const addMarkerBtn = document.getElementById('addMarkerBtn');
    const addPolygonBtn = document.getElementById('addPolygonBtn');

    if (addMarkerBtn) {
        addMarkerBtn.addEventListener('click', () => {
            if (drawingMode === 'marker') {
                // Cancela modo
                drawingMode = null;
                map.off('click', handleMapClickForMarker);
                addMarkerBtn.classList.remove('active');
                addMarkerBtn.textContent = 'Adicionar POI';
                showToast('Modo POI cancelado.', 'info');
            } else {
                // Entra em modo
                drawingMode = 'marker';
                // Limpa qualquer modo de polígono residual
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
                showToast('📍 Modo POI ativo: clique no mapa para posicionar o ponto. Em seguida preencha os dados no formulário.', 'info', 4500);
            }
        });
    }
    
    if (addPolygonBtn) {
        addPolygonBtn.addEventListener('click', () => {
            if (drawingMode === 'polygon') {
                // Tentativa de finalizar
                if (polygonPoints.length >= 3) {
                    finishPolygonAndOpenModal();
                } else {
                    // Cancela se poucos pontos
                    drawingMode = null;
                    map.off('click', handleMapClickForPolygon);
                    addPolygonBtn.classList.remove('active');
                    addPolygonBtn.textContent = 'Desenhar Polígono';
                    if (polygonTempLayer && map) {
                        map.removeLayer(polygonTempLayer);
                        polygonTempLayer = null;
                    }
                    polygonPoints = [];
                    showToast('Desenho de polígono cancelado (mínimo 3 pontos necessários).', 'info');
                }
            } else {
                // Entra em modo
                drawingMode = 'polygon';
                polygonPoints = [];
                if (polygonTempLayer && map) map.removeLayer(polygonTempLayer);
                polygonTempLayer = L.layerGroup().addTo(map);

                // Limpa modo marker
                map.off('click', handleMapClickForMarker);
                if (addMarkerBtn) {
                    addMarkerBtn.classList.remove('active');
                    addMarkerBtn.textContent = 'Adicionar POI';
                }

                map.on('click', handleMapClickForPolygon);
                addPolygonBtn.classList.add('active');
                addPolygonBtn.textContent = '✓ Finalizar Polígono';
                showToast('🗺️ Modo Polígono: clique sucessivamente no mapa para os vértices. Quando terminar (mín. 3 pontos), clique em "✓ Finalizar Polígono".', 'info', 5000);
            }
        });
    }

    setupBackupAndRoutes();
}

function handleMapClickForMarker(e) {
    // Cria feature temporária e abre modal de criação
    const feature = {
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [e.latlng.lng, e.latlng.lat]
        },
        properties: { name: '' }
    };

    // Sai do modo desenho
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

    // Feedback de quantos pontos
    const n = polygonPoints.length;
    if (n === 1) {
        showToast('1º vértice marcado. Continue clicando...', 'info', 2000);
    } else if (n === 2) {
        showToast('2 vértices. Adicione pelo menos mais 1.', 'info', 2000);
    } else {
        showToast(`${n} vértices. Clique em "✓ Finalizar Polígono" quando pronto.`, 'info', 2000);
    }
}

function finishPolygonAndOpenModal() {
    if (polygonPoints.length < 3) {
        showToast('Um polígono necessita de pelo menos 3 pontos.', 'warning');
        return;
    }

    // Fecha o anel
    const closedCoords = [...polygonPoints, polygonPoints[0]];
    const feature = {
        type: 'Feature',
        geometry: {
            type: 'Polygon',
            coordinates: [[...closedCoords.map(([lat, lng]) => [lng, lat])]]
        },
        properties: { name: '', fill: '#0288d1' }
    };

    // Limpa estado de desenho
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

// Backup Export/Import e Limpeza de Cache de Rotas
function setupBackupAndRoutes() {
    const exportBtn = document.getElementById('exportBackupBtn');
    const importBtn = document.getElementById('importBackupBtn');
    const importInput = document.getElementById('importFileInput');
    const clearRoutesBtn = document.getElementById('clearRoutesCacheBtn');

    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            if (!window.isAdmin) return;
            const backup = await DB.exportBackup();
            const blob = new Blob([backup], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gis_backup_${new Date().toISOString().slice(0,10)}.json`;
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

    if (clearRoutesBtn) {
        clearRoutesBtn.addEventListener('click', async () => {
            if (confirm('Limpar todas as rotas salvas em cache?')) {
                await DB.clearRoutesCache();
                showToast('Cache de rotas limpo com sucesso!', 'info');
            }
        });
    }
}

// ==========================================================================
// Módulo de Edição / Criação de Feições (reutilizado)
// ==========================================================================

let currentEditingContext = null;
let isJsonEditMode = false;
let isCreateMode = false;

// Abre o modal de EDIÇÃO de feição existente
window.openEditFeatureModal = async function(layerId, featureIndex) {
    if (typeof window.isAdmin === 'undefined' || !window.isAdmin) {
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
        layerData: layerData,
        feature: JSON.parse(JSON.stringify(feature))
    };

    isJsonEditMode = false;
    prepareModalForEditOrCreate();
    renderEditFeatureForm(currentEditingContext.feature);

    const jsonTextarea = document.getElementById('editFeatureJsonTextarea');
    if (jsonTextarea) {
        jsonTextarea.value = JSON.stringify(feature, null, 2);
    }

    const modal = document.getElementById('editFeatureModal');
    if (modal) modal.classList.remove('hidden');
};

// Abre o modal de CRIAÇÃO de nova feição (POI ou Polígono)
window.openCreateFeatureModal = async function(feature, defaultTitle = 'Nova Feição') {
    if (typeof window.isAdmin === 'undefined' || !window.isAdmin) {
        showToast('Você não tem permissão para criar feições.', 'error');
        return;
    }

    isCreateMode = true;
    currentEditingContext = {
        isNew: true,
        feature: JSON.parse(JSON.stringify(feature)),
        defaultTitle: defaultTitle
    };

    isJsonEditMode = false;
    prepareModalForEditOrCreate();
    renderEditFeatureForm(currentEditingContext.feature);

    // Preenche seletor de camadas
    await populateTargetLayerSelect();

    const jsonTextarea = document.getElementById('editFeatureJsonTextarea');
    if (jsonTextarea) {
        jsonTextarea.value = JSON.stringify(feature, null, 2);
    }

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
        const name = currentEditingContext.feature.properties?.name || 'Feição sem nome';
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

    // Limpa opções extras (mantém a primeira "Nova camada")
    while (select.options.length > 1) {
        select.remove(1);
    }

    const layers = await DB.getLayers();
    const hiddenNames = ['RMBH', 'Ruas', 'Logradouros', 'Street'];
    layers.forEach(layer => {
        if (hiddenNames.some(k => layer.name.includes(k))) return;
        const opt = document.createElement('option');
        opt.value = layer.id;
        opt.textContent = layer.name;
        select.appendChild(opt);
    });

    // Default = Nova camada
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

// Renderiza os campos de formulário apropriados para a feição
function renderEditFeatureForm(feature) {
    const container = document.getElementById('editFeatureFieldsContainer');
    if (!container) return;
    container.innerHTML = '';

    const props = feature.properties || {};
    const geom = feature.geometry || {};

    // 1. Coordenadas (para Pontos)
    if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
        const coordsRow = document.createElement('div');
        coordsRow.className = 'form-row-coords';
        coordsRow.innerHTML = `
            <div class="form-group-edit">
                <label>Latitude:</label>
                <input type="number" step="any" id="editProp_coordLat" value="${geom.coordinates[1] !== undefined ? geom.coordinates[1] : ''}" required>
            </div>
            <div class="form-group-edit">
                <label>Longitude:</label>
                <input type="number" step="any" id="editProp_coordLng" value="${geom.coordinates[0] !== undefined ? geom.coordinates[0] : ''}" required>
            </div>
        `;
        container.appendChild(coordsRow);
    }

    // 2. Definição de campos principais conforme o tipo
    const isPolygon = geom.type === 'Polygon' || geom.type === 'MultiPolygon';

    const mainFields = isPolygon ? [
        { key: 'name', label: 'Nome da Circunscrição / BBM:', type: 'text', value: props.name || '' },
        { key: 'NM_MUN', label: 'Município Sede / Referência:', type: 'text', value: props.NM_MUN || props.Field3 || '' },
        { key: 'CD_MUN', label: 'Código IBGE do Município:', type: 'text', value: props.CD_MUN || props.Field1 || '' },
        { key: 'AREA_KM2', label: 'Área Territorial Coberta (km²):', type: 'text', value: props.AREA_KM2 || '' },
        { key: 'Field8', label: 'Tipo da Fração (BBM, CIA, PEL, PA, etc.):', type: 'text', value: props.Field8 || '' },
        { key: 'Field10', label: 'Denominação Completa da Fração:', type: 'text', value: props.Field10 || '' },
        { key: 'Field7', label: 'Comando Operacional / Batalhão:', type: 'text', value: props.Field7 || '' },
        { key: 'Field5', label: 'Situação / Status:', type: 'text', value: props.Field5 || '' },
        { key: 'Field11', label: 'Data de Instalação (AAAA/MM/DD):', type: 'text', value: props.Field11 || '' },
        { key: 'fill', label: 'Cor de Preenchimento (Hex):', type: 'text', value: props.fill || '#0288d1' }
    ] : [
        { key: 'name', label: 'Nome da Fração / Unidade BM / POI:', type: 'text', value: props.name || '' },
        { key: 'UEOP', label: 'Batalhão / UEOP de Vinculação:', type: 'text', value: props.UEOP || '' },
        { key: 'COB', label: 'Comando Operacional (COB):', type: 'text', value: props.COB || '' }
    ];

    const renderedKeys = new Set(mainFields.map(f => f.key));
    const systemKeys = new Set([
        '_layerId', '_layerName', '_layerDbId', '_featureIndex', 
        'description', 'descrição', 'fid', 'styleUrl', 'icon', 'icon-scale',
        'fill-opacity', 'stroke-opacity', 'stroke-width', 'stroke',
        'auxiliary_storage_labeling_positionx', 'auxiliary_storage_labeling_positiony',
        'SIGLA_UF', 'Field1', 'Field3', 'Field4', 'Field9'
    ]);

    mainFields.forEach(field => {
        const group = document.createElement('div');
        group.className = 'form-group-edit';
        group.innerHTML = `
            <label>${field.label}</label>
            <input type="${field.type}" data-key="${field.key}" value="${escapeHtml(String(field.value))}">
        `;
        container.appendChild(group);
    });

    // 3. Outras propriedades existentes
    const customPropsHeader = document.createElement('div');
    customPropsHeader.innerHTML = '<h4 style="font-size:12px; color:#7f8c8d; margin-top:8px; margin-bottom:4px; text-transform:uppercase;">Outros Atributos</h4>';
    container.appendChild(customPropsHeader);

    const customContainer = document.createElement('div');
    customContainer.id = 'customPropsList';
    customContainer.style.display = 'flex';
    customContainer.style.flexDirection = 'column';
    customContainer.style.gap = '8px';

    Object.keys(props).forEach(key => {
        if (!renderedKeys.has(key) && !systemKeys.has(key)) {
            const row = createCustomPropRow(key, props[key]);
            customContainer.appendChild(row);
        }
    });

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

    row.querySelector('.btn-remove-prop').addEventListener('click', () => {
        row.remove();
    });

    return row;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
}

// Inicializa os listeners do modal de edição/criação de feições
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

    if (targetLayerSelect) {
        targetLayerSelect.addEventListener('change', toggleNewLayerNameVisibility);
    }

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
            const name = currentEditingContext.feature.properties?.name || 'esta feição';
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
                // 1. Atualiza o objeto feature a partir do formulário ou JSON
                if (isJsonEditMode) {
                    const parsed = JSON.parse(jsonTextarea.value);
                    currentEditingContext.feature = parsed;
                } else {
                    applyFormValuesToFeature(currentEditingContext.feature);
                }

                // 2. Fluxo de CRIAÇÃO
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
                        const geojson = {
                            type: 'FeatureCollection',
                            features: [currentEditingContext.feature]
                        };
                        await DB.saveLayer({
                            name: layerName,
                            type: 'geojson',
                            geojson: geojson
                        });
                        showToast(`Feição criada na nova camada "${layerName}"!`, 'success');
                    } else {
                        const layerId = Number(targetValue);
                        const layerData = await DB.getLayerById(layerId);
                        if (!layerData) {
                            showToast('Camada de destino não encontrada.', 'error');
                            return;
                        }
                        if (!layerData.geojson) {
                            layerData.geojson = { type: 'FeatureCollection', features: [] };
                        }
                        if (!Array.isArray(layerData.geojson.features)) {
                            layerData.geojson.features = [];
                        }
                        layerData.geojson.features.push(currentEditingContext.feature);
                        await DB.updateLayer(layerId, { geojson: layerData.geojson });
                        showToast(`Feição adicionada à camada "${layerData.name}"!`, 'success');
                    }
                } 
                // 3. Fluxo de EDIÇÃO
                else {
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

// Aplica valores do formulário de volta ao objeto feature
function applyFormValuesToFeature(feature) {
    if (!feature.properties) feature.properties = {};

    const fieldsContainer = document.getElementById('editFeatureFieldsContainer');
    if (!fieldsContainer) return;

    // Coordenadas de ponto
    const latInput = document.getElementById('editProp_coordLat');
    const lngInput = document.getElementById('editProp_coordLng');
    if (latInput && lngInput && feature.geometry && feature.geometry.type === 'Point') {
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

    // Campos principais
    const inputs = fieldsContainer.querySelectorAll('input[data-key]');
    inputs.forEach(input => {
        const key = input.dataset.key;
        feature.properties[key] = input.value.trim();
    });

    // Campos customizados
    const customRows = fieldsContainer.querySelectorAll('.custom-prop-row');
    customRows.forEach(row => {
        const keyInput = row.querySelector('.custom-prop-key');
        const valInput = row.querySelector('.custom-prop-value');
        if (keyInput && valInput) {
            const k = keyInput.value.trim();
            const v = valInput.value.trim();
            if (k) {
                feature.properties[k] = v;
            }
        }
    });

    // Descrição sintética
    if (feature.properties.UEOP && feature.properties.COB) {
        feature.properties.description = `COB: ${feature.properties.COB}<br>UEOP: ${feature.properties.UEOP}`;
    }
}

// Sincroniza os campos do formulário para o texto JSON bruto
function syncFormToJson() {
    if (!currentEditingContext) return;
    applyFormValuesToFeature(currentEditingContext.feature);
    const jsonTextarea = document.getElementById('editFeatureJsonTextarea');
    if (jsonTextarea) {
        jsonTextarea.value = JSON.stringify(currentEditingContext.feature, null, 2);
    }
}
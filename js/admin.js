// js/admin.js - Autenticação por PIN, upload de KML/KMZ/GeoJSON, backup e ferramentas de desenho

// Configura estado visual e botões da seção administrativa
function setupAuth() {
    const adminTools = document.getElementById('adminTools');
    const loginBtn = document.getElementById('adminLoginBtn');
    const logoutBtn = document.getElementById('adminLogoutBtn');

    if (window.isAdmin) {
        if (adminTools) adminTools.classList.remove('hidden');
        if (loginBtn) loginBtn.classList.add('hidden');
        if (logoutBtn) logoutBtn.classList.remove('hidden');
    } else {
        if (adminTools) adminTools.classList.add('hidden');
        if (loginBtn) loginBtn.classList.remove('hidden');
        if (logoutBtn) logoutBtn.classList.add('hidden');
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
        logoutBtn.addEventListener('click', () => {
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

// Ferramentas de Desenho (POI e Polígonos)
function setupDrawingTools() {
    const addMarkerBtn = document.getElementById('addMarkerBtn');
    const addPolygonBtn = document.getElementById('addPolygonBtn');

    if (addMarkerBtn) {
        addMarkerBtn.addEventListener('click', () => {
            if (drawingMode === 'marker') {
                drawingMode = null;
                map.off('click', handleMapClickForMarker);
                addMarkerBtn.classList.remove('active');
            } else {
                drawingMode = 'marker';
                map.on('click', handleMapClickForMarker);
                addMarkerBtn.classList.add('active');
                showToast('Clique no mapa para posicionar o POI.', 'info');
            }
        });
    }
    
    if (addPolygonBtn) {
        addPolygonBtn.addEventListener('click', () => {
            if (drawingMode === 'polygon') {
                drawingMode = null;
                map.off('click', handleMapClickForPolygon);
                addPolygonBtn.classList.remove('active');
                finishPolygon();
            } else {
                drawingMode = 'polygon';
                polygonPoints = [];
                if (polygonTempLayer && map) map.removeLayer(polygonTempLayer);
                polygonTempLayer = L.layerGroup().addTo(map);
                map.on('click', handleMapClickForPolygon);
                addPolygonBtn.classList.add('active');
                showToast('Clique no mapa para adicionar os vértices do polígono.', 'info');
            }
        });
    }

    setupBackupAndRoutes();
}

function handleMapClickForMarker(e) {
    const name = prompt('Nome do POI (Ponto de Interesse):');
    if (name && name.trim()) {
        const feature = {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [e.latlng.lng, e.latlng.lat]
            },
            properties: { name: name.trim() }
        };
        const geojson = { type: 'FeatureCollection', features: [feature] };
        DB.saveLayer({
            name: name.trim(),
            type: 'geojson',
            geojson: geojson
        }).then(() => {
            reloadLayers();
            showToast(`POI "${name.trim()}" criado com sucesso!`, 'success');
        });
    }
    drawingMode = null;
    map.off('click', handleMapClickForMarker);
    const addMarkerBtn = document.getElementById('addMarkerBtn');
    if (addMarkerBtn) addMarkerBtn.classList.remove('active');
}

function handleMapClickForPolygon(e) {
    polygonPoints.push([e.latlng.lat, e.latlng.lng]);
    if (polygonTempLayer && map) map.removeLayer(polygonTempLayer);
    polygonTempLayer = L.layerGroup().addTo(map);
    L.polyline(polygonPoints, { color: 'blue' }).addTo(polygonTempLayer);
    polygonPoints.forEach(p => L.circleMarker(p, { radius: 4, color: 'red' }).addTo(polygonTempLayer));
}

function finishPolygon() {
    if (polygonPoints.length < 3) {
        showToast('Um polígono necessita de pelo menos 3 pontos.', 'warning');
        polygonPoints = [];
        return;
    }
    const name = prompt('Nome do polígono:');
    if (name && name.trim()) {
        const closedCoords = [...polygonPoints, polygonPoints[0]];
        const feature = {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [[...closedCoords.map(([lat, lng]) => [lng, lat])]]
            },
            properties: { name: name.trim() }
        };
        const geojson = { type: 'FeatureCollection', features: [feature] };
        DB.saveLayer({
            name: name.trim(),
            type: 'geojson',
            geojson: geojson
        }).then(() => {
            reloadLayers();
            showToast(`Polígono "${name.trim()}" criado com sucesso!`, 'success');
        });
    }
    if (polygonTempLayer && map) map.removeLayer(polygonTempLayer);
    polygonTempLayer = null;
    polygonPoints = [];
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
// Módulo de Edição de Feições (Atributos, Geometria e JSON)
// ==========================================================================

let currentEditingContext = null;
let isJsonEditMode = false;

// Abre o modal de edição carregando a feição selecionada
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

    currentEditingContext = {
        layerId: Number(layerId),
        featureIndex: Number(featureIndex),
        layerData: layerData,
        feature: JSON.parse(JSON.stringify(feature)) // Cópia profunda
    };

    isJsonEditMode = false;
    const jsonContainer = document.getElementById('editFeatureJsonContainer');
    const fieldsContainer = document.getElementById('editFeatureFieldsContainer');
    const toggleBtn = document.getElementById('toggleJsonModeBtn');

    if (jsonContainer) jsonContainer.classList.add('hidden');
    if (fieldsContainer) fieldsContainer.classList.remove('hidden');
    if (toggleBtn) toggleBtn.textContent = '📋 Alternar Modo JSON';

    // Configura títulos
    const modalTitle = document.getElementById('editFeatureModalTitle');
    const modalSubtitle = document.getElementById('editFeatureCategory');
    const name = feature.properties?.name || 'Feição sem nome';
    const classification = typeof getFeatureClassification === 'function' ? getFeatureClassification(feature) : feature.geometry?.type;

    if (modalTitle) modalTitle.textContent = `✏️ Editar Feição: ${name}`;
    if (modalSubtitle) modalSubtitle.textContent = `Camada: "${layerData.name}" | Tipo: ${classification} (${feature.geometry?.type})`;

    renderEditFeatureForm(currentEditingContext.feature);

    const jsonTextarea = document.getElementById('editFeatureJsonTextarea');
    if (jsonTextarea) {
        jsonTextarea.value = JSON.stringify(feature, null, 2);
    }

    const modal = document.getElementById('editFeatureModal');
    if (modal) modal.classList.remove('hidden');
};

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
        { key: 'name', label: 'Nome da Fração / Unidade BM:', type: 'text', value: props.name || '' },
        { key: 'UEOP', label: 'Batalhão / UEOP de Vinculação:', type: 'text', value: props.UEOP || '' },
        { key: 'COB', label: 'Comando Operacional (COB):', type: 'text', value: props.COB || '' }
    ];

    const renderedKeys = new Set(mainFields.map(f => f.key));
    // Ignorar chaves de controle interno na lista de campos customizados
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

// Cria uma linha para propriedade personalizada (chave e valor)
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
    return str.replace(/&/g, '&amp;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
}

// Inicializa os listeners do modal de edição de feições
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

    const closeModal = () => {
        if (modal) modal.classList.add('hidden');
        currentEditingContext = null;
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    if (toggleJsonBtn) {
        toggleJsonBtn.addEventListener('click', () => {
            isJsonEditMode = !isJsonEditMode;
            if (isJsonEditMode) {
                // Sincroniza do formulário para o JSON antes de alternar
                syncFormToJson();
                if (fieldsContainer) fieldsContainer.classList.add('hidden');
                if (jsonContainer) jsonContainer.classList.remove('hidden');
                toggleBtn.textContent = '📝 Modo Formulário';
            } else {
                // Sincroniza do JSON para o formulário
                try {
                    const parsed = JSON.parse(jsonTextarea.value);
                    currentEditingContext.feature = parsed;
                    renderEditFeatureForm(parsed);
                    if (jsonContainer) jsonContainer.classList.add('hidden');
                    if (fieldsContainer) fieldsContainer.classList.remove('hidden');
                    toggleBtn.textContent = '📋 Alternar Modo JSON';
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
            if (!currentEditingContext) return;
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
            const { layerId, featureIndex, layerData } = currentEditingContext;

            try {
                if (isJsonEditMode) {
                    const parsed = JSON.parse(jsonTextarea.value);
                    layerData.geojson.features[featureIndex] = parsed;
                } else {
                    const feature = layerData.geojson.features[featureIndex];
                    if (!feature.properties) feature.properties = {};

                    // Atualiza coordenadas se for Ponto
                    const latInput = document.getElementById('editProp_coordLat');
                    const lngInput = document.getElementById('editProp_coordLng');
                    if (latInput && lngInput && feature.geometry.type === 'Point') {
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

                    // Atualiza campos principais do formulário
                    const inputs = fieldsContainer.querySelectorAll('input[data-key]');
                    inputs.forEach(input => {
                        const key = input.dataset.key;
                        const val = input.value.trim();
                        feature.properties[key] = val;
                    });

                    // Atualiza campos customizados
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

                    // Atualiza descrição textual sintética
                    if (feature.properties.UEOP && feature.properties.COB) {
                        feature.properties.description = `COB: ${feature.properties.COB}<br>UEOP: ${feature.properties.UEOP}`;
                    }
                }

                // Salva no banco de dados local (IndexedDB)
                await DB.updateLayer(layerId, { geojson: layerData.geojson });
                await reloadLayers();
                closeModal();
                showToast('Informações da feição atualizadas com sucesso!', 'success');
            } catch (error) {
                console.error('Erro ao salvar feição:', error);
                showToast('Erro ao salvar feição: ' + error.message, 'error');
            }
        });
    }
}

// Sincroniza os campos do formulário para o texto JSON bruto
function syncFormToJson() {
    if (!currentEditingContext) return;
    const { feature } = currentEditingContext;
    const fieldsContainer = document.getElementById('editFeatureFieldsContainer');
    const jsonTextarea = document.getElementById('editFeatureJsonTextarea');
    if (!fieldsContainer || !jsonTextarea) return;

    const latInput = document.getElementById('editProp_coordLat');
    const lngInput = document.getElementById('editProp_coordLng');
    if (latInput && lngInput && feature.geometry.type === 'Point') {
        const newLat = parseFloat(latInput.value);
        const newLng = parseFloat(lngInput.value);
        if (!isNaN(newLat) && !isNaN(newLng)) {
            feature.geometry.coordinates = [newLng, newLat, feature.geometry.coordinates[2] || 0];
        }
    }

    const inputs = fieldsContainer.querySelectorAll('input[data-key]');
    inputs.forEach(input => {
        feature.properties[input.dataset.key] = input.value.trim();
    });

    const customRows = fieldsContainer.querySelectorAll('.custom-prop-row');
    customRows.forEach(row => {
        const k = row.querySelector('.custom-prop-key')?.value.trim();
        const v = row.querySelector('.custom-prop-value')?.value.trim();
        if (k) feature.properties[k] = v;
    });

    jsonTextarea.value = JSON.stringify(feature, null, 2);
}


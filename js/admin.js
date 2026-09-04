// js/admin.js - Autenticação por PIN, upload de KML/KMZ/GeoJSON, backup e ferramentas de desenho

// Configura estado visual e botões da seção administrativa
function setupAuth() {
    const adminTools = document.getElementById('adminTools');
    const loginBtn = document.getElementById('adminLoginBtn');
    const logoutBtn = document.getElementById('adminLogoutBtn');

    if (isAdmin) {
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
                isAdmin = true;
                if (loginModal) loginModal.classList.add('hidden');
                pinInput.value = '';
                if (loginError) loginError.textContent = '';
                setupAuth();
                showToast('Login de Administrador bem-sucedido!', 'success');
            } else {
                if (loginError) loginError.textContent = 'PIN incorreto. Tente novamente.';
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            isAdmin = false;
            setupAuth();
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
    if (!isAdmin) return;
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
            if (!isAdmin) return;
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

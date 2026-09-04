// app.js - Lógica principal da aplicação

// Variáveis globais
let map;
let mapClickMode = false;
let baseLayer;
let overlayLayers = {}; // { layerId: L.GeoJSON }
let originMarker = null; // Marcador de origem para cálculo de distância
let currentSearchResult = null; // Resultado da busca atual
let isAdmin = false;
let drawingMode = null; // 'marker' ou 'polygon'
let polygonPoints = []; // Pontos temporários para desenho de polígono
let polygonTempLayer = null; // Layer temporário para visualizar polígono em desenho
let adminPinHash = localStorage.getItem('adminPinHash');

// Novas variáveis para controle de visualização
let viewMode = 'all';          // 'all' | 'points' | 'none'
let layerVisibility = {};      // armazena se cada camada está visível (true/false)

// Classe customizada de TileLayer com cache em IndexedDB
class OfflineTileLayer extends L.TileLayer {
    createTile(coords, done) {
        const tile = document.createElement('img');
        tile.alt = '';
        tile.setAttribute('role', 'presentation');
        
        const tileUrl = this.getTileUrl(coords);
        const tileKey = `${this._url}_${coords.z}_${coords.x}_${coords.y}`;
        
        // Tenta carregar do IndexedDB
        DB.getTile(tileKey).then(blob => {
            if (blob) {
                const objectURL = URL.createObjectURL(blob);
                tile.src = objectURL;
                tile.onload = () => {
                    URL.revokeObjectURL(objectURL);
                    done(null, tile);
                };
                tile.onerror = () => {
                    URL.revokeObjectURL(objectURL);
                    // Fallback para rede
                    this._fetchFromNetwork(tileUrl, tileKey, tile, done);
                };
            } else {
                this._fetchFromNetwork(tileUrl, tileKey, tile, done);
            }
        }).catch(err => {
            console.warn('Erro ao verificar tile no IndexedDB:', err);
            this._fetchFromNetwork(tileUrl, tileKey, tile, done);
        });
        
        return tile;
    }
    
    _fetchFromNetwork(url, key, tile, done) {
        fetch(url).then(response => {
            if (!response.ok) throw new Error('Network response was not ok');
            return response.blob();
        }).then(blob => {
            // Salva no IndexedDB
            DB.saveTile(key, blob).catch(e => console.warn('Falha ao salvar tile:', e));
            const objectURL = URL.createObjectURL(blob);
            tile.src = objectURL;
            tile.onload = () => {
                URL.revokeObjectURL(objectURL);
                done(null, tile);
            };
            tile.onerror = () => {
                URL.revokeObjectURL(objectURL);
                done(new Error('Falha ao carregar tile'), tile);
            };
        }).catch(err => {
            done(err, tile);
        });
    }
}

// Inicialização do Mapa
function initMap() {
    map = L.map('map', {
        center: [-15.7934, -47.8822], // Brasília, Brasil
        zoom: 4,
        zoomControl: false
    });

// Adiciona o controle de zoom no canto superior direito
    L.control.zoom({ position: 'topright' }).addTo(map);
    
// Adiciona controle de zoom extended (junto aos botões de zoom)
L.Control.ZoomExtended = L.Control.extend({
    onAdd: function(map) {
        const btn = L.DomUtil.create('button', 'leaflet-control-zoom-extended');
        btn.innerHTML = '⤡';
        btn.title = 'Zoom para todas as feições';
        L.DomEvent.on(btn, 'click', function(e) {
            L.DomEvent.stopPropagation(e);
            zoomToAllFeatures();
        });
        return btn;
    }
});
L.control.zoomExtended = function(opts) {
    return new L.Control.ZoomExtended(opts);
};
L.control.zoomExtended({ position: 'topright' }).addTo(map);

    // Listener de clique no mapa (para definir origem manual)
    map.on('click', (e) => {
        if (mapClickMode) {
            mapClickMode = false;
            document.getElementById('mapOriginBtn').textContent = '🎯 Definir origem no mapa';
            map.getContainer().style.cursor = '';
            
            setOrigin(e.latlng.lat, e.latlng.lng, 'Origem manual');
            map.setView([e.latlng.lat, e.latlng.lng], 15);
            calculateDistancesToAllFeatures(e.latlng.lat, e.latlng.lng);
        }
    });

    // Camada base com cache offline
    baseLayer = new OfflineTileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });
    baseLayer.addTo(map);
    
    // Carrega camadas existentes
    reloadLayers();
}


// Função para semear dados iniciais (backup)
async function seedInitialData() {
    const layers = await DB.getLayers();
    if (layers.length > 0) return;

    const response = await fetch('./data/backup_inicial.json');
    const backup = await response.json();
    const features = backup.featureCollection.features;

    // Separa por tipo de geometria
    const points = features.filter(f => f.geometry.type === 'Point');
    const polygons = features.filter(f => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');

    // Salva camada de pontos
    if (points.length) {
        await DB.saveLayer({
            name: 'Unidades CBMMG',
            type: 'geojson',
            geojson: { type: 'FeatureCollection', features: points }
        });
    }
    // Salva camada de polígonos
    if (polygons.length) {
        await DB.saveLayer({
            name: 'Articulação CBMMG',
            type: 'geojson',
            geojson: { type: 'FeatureCollection', features: polygons }
        });
    }
    await reloadLayers();
}

// Carrega os dados das ruas do GitHub na primeira execução
async function loadStreetDataFromGitHub() {
    try {
        // Verifica se já existe uma camada com nome que contenha "Ruas"
        const existingLayers = await DB.getLayers();
        const hasStreetLayer = existingLayers.some(l => l.name.includes('Ruas') || l.name.includes('Logradouros'));
        if (hasStreetLayer) {
            console.log('Dados de ruas já carregados.');
            return;
        }

        // URL base do seu repositório (troque para o seu usuário e branch)
        const baseUrl = 'https://raw.githubusercontent.com/seu-usuario/gis-pwa-offline/main/';

        // Baixa o índice
        const indexResponse = await fetch(baseUrl + 'data/ruas/index.json');
        if (!indexResponse.ok) throw new Error('Falha ao baixar índice de ruas.');
        const files = await indexResponse.json();

        // Baixa e importa cada arquivo
        for (const fileInfo of files) {
            const geojsonResponse = await fetch(baseUrl + fileInfo.url);
            if (!geojsonResponse.ok) {
                console.warn(`Falha ao baixar ${fileInfo.url}`);
                continue;
            }
            const geojson = await geojsonResponse.json();

            // Salva a camada no IndexedDB
            await DB.saveLayer({
                name: fileInfo.name,
                type: 'geojson',
                geojson: geojson
            });
            console.log(`Camada "${fileInfo.name}" importada com sucesso.`);
        }

        // Recarrega as camadas no mapa
        await reloadLayers();
        alert('Dados das ruas carregados com sucesso!');

    } catch (error) {
        console.error('Erro ao carregar dados das ruas:', error);
        // Não impede o funcionamento, apenas avisa
    }
}

// Recarrega todas as camadas do banco e adiciona ao mapa
async function reloadLayers() {
    // Remove camadas antigas do mapa
    Object.values(overlayLayers).forEach(layer => {
        if (map.hasLayer(layer)) map.removeLayer(layer);
    });
    overlayLayers = {};
    
    const layers = await DB.getLayers();
    for (const layerData of layers) {
        // Se a camada não tiver estado de visibilidade, define como true por padrão
        if (layerVisibility[layerData.id] === undefined) {
            layerVisibility[layerData.id] = true;
        }
        // Adiciona ao mapa apenas se estiver visível
        if (layerVisibility[layerData.id]) {
            addLayerToMap(layerData, viewMode);
        }
    }
    updateLayerListUI();
}

// Adiciona uma camada ao mapa a partir dos dados, com filtro opcional
function addLayerToMap(layerData, mode = viewMode) {
    if (!layerData.geojson) return;

    const geojsonLayer = L.geoJSON(layerData.geojson, {
        // Filtro baseado no modo de visualização
        filter: function(feature) {
            if (mode === 'none') return false;
            if (mode === 'points') {
                return feature.geometry.type === 'Point';
            }
            return true; // 'all'
        },
        pointToLayer: (feature, latlng) => {
            if (feature.geometry.type === 'Point') {
                return L.circleMarker(latlng, {
                    radius: 8,
                    fillColor: '#e74c3c',
                    color: '#c0392b',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.8
                });
            }
            return L.marker(latlng);
        },
        onEachFeature: (feature, layer) => {
            layer.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                handleFeatureClick(e, feature, layer);
            });
        }
    });

    geojsonLayer.addTo(map);
    overlayLayers[layerData.id] = geojsonLayer;

    // Se a camada contém pontos, trazê-la para frente
    const hasPoints = layerData.geojson.features.some(f => f.geometry.type === 'Point');
    if (hasPoints) {
        geojsonLayer.bringToFront();
    }
}

// Atualiza a lista de camadas na UI
function updateLayerListUI() {
    const ul = document.getElementById('layersUl');
    DB.getLayers().then(layers => {
        ul.innerHTML = '';
        layers.forEach(layer => {
            const isVisible = layerVisibility[layer.id] !== false; // true por padrão
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${layer.name}</span>
                <div>
                    <button class="btn-toggle" data-id="${layer.id}">${isVisible ? '👁️' : '👁️‍🗨️'}</button>
                    ${isAdmin ? `<button class="btn-delete" data-id="${layer.id}">🗑️</button>` : ''}
                </div>
            `;
            ul.appendChild(li);
        });

        // Event listeners dos toggles
        document.querySelectorAll('.btn-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = Number(e.target.dataset.id);
                // Inverte visibilidade
                layerVisibility[id] = !layerVisibility[id];
                // Recarrega todas as camadas para aplicar a mudança
                reloadLayers();
            });
        });

        if (isAdmin) {
            document.querySelectorAll('.btn-delete').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = Number(e.target.dataset.id);
                    if (confirm('Excluir esta camada?')) {
                        await DB.deleteLayer(id);
                        delete layerVisibility[id];
                        if (overlayLayers[id]) {
                            map.removeLayer(overlayLayers[id]);
                            delete overlayLayers[id];
                        }
                        reloadLayers();
                    }
                });
            });
        }
    });
}

// Define o modo de visualização e recarrega as camadas
function setViewMode(mode) {
    viewMode = mode;
    syncViewCheckboxes(mode);
    reloadLayers();
}

// Sincroniza os checkboxes com o modo atual
function syncViewCheckboxes(mode) {
    document.querySelectorAll('.view-checkbox').forEach(cb => {
        cb.checked = (cb.dataset.mode === mode);
    });
}


// Botão de reset - limpa tudo
document.getElementById('resetBtn').addEventListener('click', resetAll);

function resetAll() {
    // Limpa resultados de busca e distâncias
    document.getElementById('searchResults').innerHTML = '';
    document.getElementById('distanceResults').innerHTML = '';
    document.getElementById('searchInput').value = '';

    // Reseta o botão de origem no mapa
    if (mapClickMode) {
        mapClickMode = false;
        document.getElementById('mapOriginBtn').textContent = '🎯 Definir origem no mapa';
        map.getContainer().style.cursor = '';
    }

    // Remove marcador de origem
    if (originMarker) {
        map.removeLayer(originMarker);
        originMarker = null;
    }
    // Remove linhas e marcadores de distância
    if (window.distanceLine) {
        map.removeLayer(window.distanceLine);
        window.distanceLine = null;
    }
    if (window.distanceMarker) {
        map.removeLayer(window.distanceMarker);
        window.distanceMarker = null;
    }
    // Reseta referência de resultado atual
    currentSearchResult = null;
    // Volta para a vista inicial (Brasília)
    map.setView([-15.7934, -47.8822], 4);
}

// Função auxiliar para extrair coordenadas [lat, lng] de qualquer geometria
function extractCoordinates(geometry) {
    const coords = [];
    if (geometry.type === 'Point') {
        coords.push([geometry.coordinates[1], geometry.coordinates[0]]);
    } else if (geometry.type === 'MultiPoint') {
        geometry.coordinates.forEach(c => coords.push([c[1], c[0]]));
    } else if (geometry.type === 'LineString') {
        geometry.coordinates.forEach(c => coords.push([c[1], c[0]]));
    } else if (geometry.type === 'MultiLineString') {
        geometry.coordinates.forEach(line => line.forEach(c => coords.push([c[1], c[0]])));
    } else if (geometry.type === 'Polygon') {
        geometry.coordinates[0].forEach(c => coords.push([c[1], c[0]]));
    } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach(poly => poly[0].forEach(c => coords.push([c[1], c[0]])));
    } else if (geometry.type === 'GeometryCollection') {
        geometry.geometries.forEach(g => coords.push(...extractCoordinates(g)));
    }
    return coords;
}

function zoomToAllFeatures() {
    const bounds = new L.LatLngBounds();
    let hasFeatures = false;

    for (const layerId in overlayLayers) {
        const layer = overlayLayers[layerId];
        if (!map.hasLayer(layer)) continue; // só camadas visíveis
        layer.eachLayer(function(l) {
            if (l.feature && l.feature.geometry) {
                const coords = extractCoordinates(l.feature.geometry);
                coords.forEach(coord => {
                    bounds.extend(coord);
                    hasFeatures = true;
                });
            }
        });
    }

    if (hasFeatures) {
        map.fitBounds(bounds, { padding: [50, 50] });
    } else {
        // Se nenhuma feature, volta para Brasília
        map.setView([-15.7934, -47.8822], 4);
    }
}

// Autenticação Admin
function setupAuth() {
    // Mostra/oculta ferramentas admin conforme estado
    if (isAdmin) {
        document.getElementById('adminTools').classList.remove('hidden');
        document.getElementById('adminLoginBtn').classList.add('hidden');
        document.getElementById('adminLogoutBtn').classList.remove('hidden');
    } else {
        document.getElementById('adminTools').classList.add('hidden');
        document.getElementById('adminLoginBtn').classList.remove('hidden');
        document.getElementById('adminLogoutBtn').classList.add('hidden');
    }
    updateLayerListUI(); // Atualiza para mostrar botões de exclusão
}

document.getElementById('adminLoginBtn').addEventListener('click', () => {
    document.getElementById('loginModal').classList.remove('hidden');
});

document.getElementById('closeLoginModal').addEventListener('click', () => {
    document.getElementById('loginModal').classList.add('hidden');
});

document.getElementById('confirmLoginBtn').addEventListener('click', () => {
    const pin = document.getElementById('pinInput').value;
    if (verifyPin(pin)) {
        isAdmin = true;
        document.getElementById('loginModal').classList.add('hidden');
        document.getElementById('pinInput').value = '';
        setupAuth();
        alert('Login admin bem-sucedido.');
    } else {
        document.getElementById('loginError').textContent = 'PIN incorreto.';
    }
});

document.getElementById('adminLogoutBtn').addEventListener('click', () => {
    isAdmin = false;
    setupAuth();
});

// Função para verificar PIN (hash simples SHA-256)
function verifyPin(pin) {
    if (!adminPinHash) {
        // Primeira vez: define o PIN
        setAdminPin(pin);
        isAdmin = true;
        return true;
    }
    const hash = sha256(pin);
    return hash === adminPinHash;
}

function setAdminPin(pin) {
    const hash = sha256(pin);
    localStorage.setItem('adminPinHash', hash);
    adminPinHash = hash;
}

// Função para gerar hash SHA-256 (hex string)
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

// Verifica o PIN de forma assíncrona
async function verifyPinAsync(pin) {
    const storedHash = localStorage.getItem('adminPinHash');
    
    // Se não existe hash salvo, este é o primeiro acesso: define o PIN
    if (!storedHash) {
        const newHash = await sha256(pin);
        if (newHash) {
            localStorage.setItem('adminPinHash', newHash);
            return true;
        }
        return false;
    }
    
    // Caso contrário, verifica o hash do PIN fornecido
    const hash = await sha256(pin);
    return hash === storedHash;
}

// Listener do botão de login
document.getElementById('confirmLoginBtn').addEventListener('click', async () => {
    const pin = document.getElementById('pinInput').value.trim(); // remove espaços extras
    const success = await verifyPinAsync(pin);
    if (success) {
        isAdmin = true;
        document.getElementById('loginModal').classList.add('hidden');
        document.getElementById('pinInput').value = '';
        document.getElementById('loginError').textContent = '';
        setupAuth();
    } else {
        document.getElementById('loginError').textContent = 'PIN incorreto. Tente novamente.';
    }
});

// Funções Admin: Upload KML/KMZ
function setupFileUpload() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    
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

async function handleFiles(files) {
    if (!isAdmin) return;
    for (const file of files) {
        try {
            let geojson;
            if (file.name.toLowerCase().endsWith('.kml')) {
                const text = await file.text();
                const kmlDom = new DOMParser().parseFromString(text, 'text/xml');
                geojson = toGeoJSON.kml(kmlDom);
            } else if (file.name.toLowerCase().endsWith('.kmz')) {
                const zip = await JSZip.loadAsync(file);
                const kmlFile = Object.values(zip.files).find(f => f.name.toLowerCase().endsWith('.kml'));
                if (!kmlFile) throw new Error('Nenhum arquivo KML encontrado no KMZ');
                const kmlText = await kmlFile.async('text');
                const kmlDom = new DOMParser().parseFromString(kmlText, 'text/xml');
                geojson = toGeoJSON.kml(kmlDom);
} else if (ext === 'json' || ext === 'geojson') {
                const text = await file.text();
                geojson = JSON.parse(text);
                // Garante que é um FeatureCollection
                if (!geojson.type || geojson.type !== 'FeatureCollection') {
                    if (geojson.type === 'Feature') {
                        geojson = { type: 'FeatureCollection', features: [geojson] };
                    } else if (geojson.type === 'Point' || geojson.type === 'Polygon' || geojson.type === 'LineString') {
                        geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geojson, properties: {} }] };
                    } else {
                        throw new Error('GeoJSON inválido');
                    }
                }
            } else {
                alert('Formato não suportado: ' + file.name);
                continue;
            }
            
            // Salva como nova camada
            const layerName = file.name.replace(/\.(kml|kmz)$/i, '');

            // Verifica se já existe camada com o mesmo nome
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
            console.log(`Camada ${layerName} carregada com sucesso.`);
        } catch (error) {
            console.error('Erro ao processar arquivo:', error);
            alert('Erro ao processar ' + file.name + ': ' + error.message);
        }
    }
}

// Ferramentas de desenho
function setupDrawingTools() {
    document.getElementById('addMarkerBtn').addEventListener('click', () => {
        if (drawingMode === 'marker') {
            drawingMode = null;
            map.off('click', handleMapClickForMarker);
            document.getElementById('addMarkerBtn').classList.remove('active');
        } else {
            drawingMode = 'marker';
            map.on('click', handleMapClickForMarker);
            document.getElementById('addMarkerBtn').classList.add('active');
        }
    });
    
    document.getElementById('addPolygonBtn').addEventListener('click', () => {
        if (drawingMode === 'polygon') {
            drawingMode = null;
            map.off('click', handleMapClickForPolygon);
            document.getElementById('addPolygonBtn').classList.remove('active');
            // Finaliza polígono se existir
            finishPolygon();
        } else {
            drawingMode = 'polygon';
            polygonPoints = [];
            if (polygonTempLayer) map.removeLayer(polygonTempLayer);
            polygonTempLayer = L.layerGroup().addTo(map);
            map.on('click', handleMapClickForPolygon);
            document.getElementById('addPolygonBtn').classList.add('active');
        }
    });
}

function handleMapClickForMarker(e) {
    const name = prompt('Nome do POI:');
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
        }).then(() => reloadLayers());
    }
    drawingMode = null;
    map.off('click', handleMapClickForMarker);
    document.getElementById('addMarkerBtn').classList.remove('active');
}

function handleMapClickForPolygon(e) {
    polygonPoints.push([e.latlng.lat, e.latlng.lng]);
    // Atualiza visualização temporária
    if (polygonTempLayer) map.removeLayer(polygonTempLayer);
    polygonTempLayer = L.layerGroup().addTo(map);
    L.polyline(polygonPoints, { color: 'blue' }).addTo(polygonTempLayer);
    polygonPoints.forEach(p => L.circleMarker(p, { radius: 4, color: 'red' }).addTo(polygonTempLayer));
}

function finishPolygon() {
    if (polygonPoints.length < 3) {
        alert('Polígono precisa de pelo menos 3 pontos.');
        polygonPoints = [];
        return;
    }
    const name = prompt('Nome do polígono:');
    if (name && name.trim()) {
        // Fecha o polígono adicionando o primeiro ponto ao final
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
        }).then(() => reloadLayers());
    }
    if (polygonTempLayer) map.removeLayer(polygonTempLayer);
    polygonTempLayer = null;
    polygonPoints = [];
}

// Export/Import Backup
document.getElementById('exportBackupBtn').addEventListener('click', async () => {
    if (!isAdmin) return;
    const backup = await DB.exportBackup();
    const blob = new Blob([backup], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gis_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('importBackupBtn').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
});

document.getElementById('importFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const success = await DB.importBackup(text);
    if (success) {
        alert('Backup importado com sucesso.');
        await reloadLayers();
    } else {
        alert('Erro ao importar backup.');
    }
    e.target.value = '';
});

// Botão para limpar cache de rotas
document.getElementById('clearRoutesCacheBtn').addEventListener('click', async () => {
    if (confirm('Limpar todas as rotas em cache?')) {
        await DB.clearRoutesCache();
        alert('Cache de rotas limpo.');
    }
});

// Download de Tiles Offline
document.getElementById('downloadTilesBtn').addEventListener('click', () => {
    if (!isAdmin) return;
    document.getElementById('tileModal').classList.remove('hidden');
});

document.getElementById('closeTileModal').addEventListener('click', () => {
    document.getElementById('tileModal').classList.add('hidden');
});

document.getElementById('startTileDownload').addEventListener('click', async () => {
    const minZoom = parseInt(document.getElementById('minZoom').value);
    const maxZoom = parseInt(document.getElementById('maxZoom').value);
    if (minZoom > maxZoom) {
        alert('Zoom mínimo deve ser menor ou igual ao máximo.');
        return;
    }
    
    const bounds = map.getBounds();
    const progressDiv = document.getElementById('tileProgress');
    progressDiv.innerHTML = 'Baixando tiles...';
    
    let totalTiles = 0;
    let completedTiles = 0;
    
    // Calcula o número total de tiles
    for (let z = minZoom; z <= maxZoom; z++) {
        const tileRange = getTileRange(bounds, z);
        totalTiles += (tileRange.maxX - tileRange.minX + 1) * (tileRange.maxY - tileRange.minY + 1);
    }
    
    for (let z = minZoom; z <= maxZoom; z++) {
        const tileRange = getTileRange(bounds, z);
        for (let x = tileRange.minX; x <= tileRange.maxX; x++) {
            for (let y = tileRange.minY; y <= tileRange.maxY; y++) {
                const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
                const key = `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png_${z}_${x}_${y}`;
                try {
                    const response = await fetch(url);
                    if (response.ok) {
                        const blob = await response.blob();
                        await DB.saveTile(key, blob);
                    }
                } catch (e) {
                    console.warn(`Falha ao baixar tile ${z}/${x}/${y}`, e);
                }
                completedTiles++;
                progressDiv.innerHTML = `Baixando tiles: ${completedTiles}/${totalTiles}`;
            }
        }
    }
    progressDiv.innerHTML = 'Download concluído!';
    setTimeout(() => {
        document.getElementById('tileModal').classList.add('hidden');
        progressDiv.innerHTML = '';
    }, 2000);
});

function getTileRange(bounds, zoom) {
    const nw = bounds.getNorthWest();
    const se = bounds.getSouthEast();
    const minX = long2tile(nw.lng, zoom);
    const maxX = long2tile(se.lng, zoom);
    const minY = lat2tile(se.lat, zoom);
    const maxY = lat2tile(nw.lat, zoom);
    return { minX, maxX, minY, maxY };
}

function long2tile(lon, zoom) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
    return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
}

// Pesquisa de Endereços (Online/Offline)
async function searchAddress(query) {
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = 'Buscando...';
    
    // 1. Busca offline na tabela addresses (como já faz)
    const offlineResults = await DB.searchAddresses(query);
    if (offlineResults.length > 0) {
        displaySearchResults(offlineResults);
        return;
    }

    // 2. Busca nas camadas de ruas (GeoJSON com geometria LineString/MultiLineString)
    const allFeatures = [];
    for (const layerId in overlayLayers) {
        const layerData = await DB.getLayerById(Number(layerId));
        if (!layerData || !layerData.geojson) continue;
        for (const feature of layerData.geojson.features) {
            // Verifica se é uma linha (rua) e tem atributo de nome
            if (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') {
                // Tenta vários campos possíveis (prioridade para NM_LOG, que é o do IBGE)
                const name = feature.properties?.NM_LOG || 
                             feature.properties?.nome || 
                             feature.properties?.name || 
                             feature.properties?.NM_LOGRADOURO || 
                             feature.properties?.logradouro || '';
                if (name.toLowerCase().includes(query.toLowerCase())) {
                    // Pega o primeiro ponto da linha como referência
                    const coords = feature.geometry.type === 'LineString' 
                        ? feature.geometry.coordinates[0] 
                        : feature.geometry.coordinates[0][0];
                    allFeatures.push({
                        query: query,
                        lat: coords[1],
                        lng: coords[0],
                        address: name
                    });
                }
            }
        }
    }
    if (allFeatures.length > 0) {
        displaySearchResults(allFeatures);
        return;
    }

    // 3. Se estiver online, busca na Nominatim (como já faz)
    if (navigator.onLine) {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
            const data = await response.json();
            if (data.length > 0) {
                const results = data.map(item => ({
                    query: query,
                    lat: parseFloat(item.lat),
                    lng: parseFloat(item.lon),
                    address: item.display_name
                }));
                // Armazena resultados no banco para uso offline futuro
                results.forEach(r => DB.addAddress(r));
                displaySearchResults(results);
            } else {
                resultsDiv.innerHTML = 'Nenhum resultado encontrado.';
            }
        } catch (error) {
            resultsDiv.innerHTML = 'Erro na busca online. Tente novamente.';
        }
    } else {
        resultsDiv.innerHTML = 'Sem conexão e nenhum resultado offline.';
    }
}

function displaySearchResults(results) {
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '';
    results.forEach((result, index) => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.textContent = result.address;
        div.addEventListener('click', () => {
            setOrigin(result.lat, result.lng, result.address);
            map.setView([result.lat, result.lng], 15);
            resultsDiv.innerHTML = '';
            calculateDistancesToAllFeatures(result.lat, result.lng);
        });
        resultsDiv.appendChild(div);
    });
}

// Define um ponto de origem para cálculo de distâncias
function setOrigin(lat, lng, description) {
    if (originMarker) map.removeLayer(originMarker);
    originMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    originMarker.bindPopup(`<b>Origem:</b> ${description}<br>Arraste para ajustar.`).openPopup();
    
    // Atualiza o popup com polígonos (assíncrono)
    updateOriginPopup(lat, lng, description);
    
    originMarker.on('dragend', () => {
        const pos = originMarker.getLatLng();
        currentSearchResult = { lat: pos.lat, lng: pos.lng, address: description };
        calculateDistancesToAllFeatures(pos.lat, pos.lng);
        updateOriginPopup(pos.lat, pos.lng, description);
    });
    
    currentSearchResult = { lat, lng, address: description };
}

// Função para atualizar o conteúdo do popup do marcador de origem com informações de polígonos
async function updateOriginPopup(lat, lng, description) {
    const containingPolygons = await checkPolygonContainment(lat, lng);
    let popupContent = `<b>Origem:</b> ${description}<br>`;
    if (containingPolygons.length > 0) {
        const names = containingPolygons.map(p => p.featureName).join(', ');
        popupContent += `<b>Dentro de:</b> ${names}<br>`;
    } else {
        popupContent += 'Não está dentro de nenhum polígono.<br>';
    }
    popupContent += 'Arraste para ajustar.';
    
    if (originMarker) {
        originMarker.setPopupContent(popupContent);
        originMarker.openPopup(); // reabre para atualizar
    }
}

// Função para calcular e exibir distâncias (apenas linha reta)
async function calculateDistancesToAllFeatures(originLat, originLng) {
    const distanceContainer = document.getElementById('distanceResults');
    distanceContainer.innerHTML = '<p>Calculando distâncias em linha reta...</p>';

    // 1. Verifica polígonos que contêm o ponto
    const containingPolygons = await checkPolygonContainment(originLat, originLng);
    let html = '';

    if (containingPolygons.length > 0) {
        html += '<h4 style="margin:5px 0;">Polígono(s) que contém este ponto:</h4>';
        html += '<ul style="list-style:none; padding-left:0; margin-top:2px;">';
        containingPolygons.forEach(p => {
            html += `<li>• ${p.featureName} (${p.layerName})</li>`;
        });
        html += '</ul><hr>';
    } else {
        html += '<p><strong>O ponto não está dentro de nenhum polígono.</strong></p><hr>';
    }

    distanceContainer.innerHTML = html + '<p>Calculando distâncias...</p>';

    // 2. Calcula distâncias em linha reta para todos os pontos
    const originPoint = turf.point([originLng, originLat]);
    const results = [];

    for (const layerId in overlayLayers) {
        const layerData = await DB.getLayerById(Number(layerId));
        if (!layerData || !layerData.geojson) continue;

        for (const feature of layerData.geojson.features) {
            if (feature.geometry.type !== 'Point') continue;

            const coords = feature.geometry.coordinates;
            const destPoint = turf.point(coords);
            const distanceKm = turf.distance(originPoint, destPoint, { units: 'kilometers' });

            results.push({
                layerName: layerData.name,
                featureName: feature.properties?.name || 'Sem nome',
                distanceKm: distanceKm,
                destination: coords,
                // source sempre 'straight' pois só calculamos linha reta agora
                source: 'straight'
            });
        }
    }

    // Ordena e exibe os 10 mais próximos
    results.sort((a, b) => a.distanceKm - b.distanceKm);
    const topResults = results.slice(0, 10);

    if (topResults.length === 0) {
        html += '<p>Nenhum ponto encontrado nas camadas.</p>';
    } else {
        html += '<h4 style="margin:5px 0;">10 pontos mais próximos (linha reta):</h4>';
        html += '<ul style="list-style:none; padding-left:0; margin-top:2px;">';
        for (const res of topResults) {
            const km = res.distanceKm.toFixed(2);
            const m = (res.distanceKm * 1000).toFixed(0);
            html += `<li style="padding:5px; border-bottom:1px solid #eee; cursor:pointer;" 
                         onclick="focusOnFeature(${res.destination[0]}, ${res.destination[1]}, '${res.featureName}', ${res.distanceKm})">
                        <strong>${res.featureName}</strong> (${res.layerName})<br>
                        <span style="color:#c0392b;">${km} km (${m} m)</span>
                        <span style="font-size:0.8em; color:#666; margin-left:8px;">➡️ linha reta</span>
                    </li>`;
        }
        html += '</ul>';
    }

    distanceContainer.innerHTML = html;
}

// Função para obter distância por rota (com cache e fallback)
async function getRouteDistance(originLat, originLng, destLat, destLng) {
    // 1. Verifica no cache
    const cached = await DB.getRouteFromCache(originLat, originLng, destLat, destLng);
    if (cached) {
        return {
            distance: cached.distance, // metros
            duration: cached.duration,
            source: 'cache'
        };
    }

    // 2. Se estiver online, calcula via OSRM
    if (navigator.onLine) {
        try {
            const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=false`;
            const response = await fetch(url);
            const data = await response.json();
            if (data.code === 'Ok') {
                const distance = data.routes[0].distance; // metros
                const duration = data.routes[0].duration; // segundos
                // Salva no cache
                await DB.saveRouteToCache(originLat, originLng, destLat, destLng, distance, duration);
                return { distance, duration, source: 'online' };
            }
        } catch (e) {
            console.warn('Falha ao obter rota online:', e);
        }
    }

    // 3. Fallback: distância em linha reta (turf)
    const from = turf.point([originLng, originLat]);
    const to = turf.point([destLng, destLat]);
    const straightDistance = turf.distance(from, to, { units: 'kilometers' }) * 1000; // metros
    // Não salvamos no cache para evitar dados imprecisos
    return {
        distance: straightDistance,
        duration: null,
        source: 'straight'
    };
}

// Verifica em quais polígonos (feature.type Polygon/MultiPolygon) o ponto está contido
async function checkPolygonContainment(lat, lng) {
    const point = turf.point([lng, lat]);
    const containingPolygons = [];

    // Itera sobre as camadas ativas no mapa (objeto overlayLayers)
    for (const layerId in overlayLayers) {
        const layerData = await DB.getLayerById(Number(layerId));
        if (!layerData || !layerData.geojson || !layerData.geojson.features) continue;

        for (const feature of layerData.geojson.features) {
            // Somente polígonos
            if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
                try {
                    const polygonFeature = turf.feature(feature.geometry);
                    if (turf.booleanPointInPolygon(point, polygonFeature)) {
                        containingPolygons.push({
                            layerName: layerData.name,
                            featureName: feature.properties?.name || 'Sem nome'
                        });
                    }
                } catch (e) {
                    console.warn('Erro ao verificar contenção do polígono:', e);
                }
            }
        }
    }
    return containingPolygons;
}

// Função para focar no mapa e mostrar rota (ou linha reta) até a feature selecionada
async function focusOnFeature(lng, lat, name, distance) {
    if (!originMarker) return;
    const originPos = originMarker.getLatLng();

    // Remove elementos anteriores
    if (window.distanceLine) {
        map.removeLayer(window.distanceLine);
        window.distanceLine = null;
    }
    if (window.distanceMarker) {
        map.removeLayer(window.distanceMarker);
        window.distanceMarker = null;
    }
    if (window.routingControl) {
        map.removeControl(window.routingControl);
        window.routingControl = null;
    }

    // Se estiver online, tenta obter a rota real (com cache)
    if (navigator.onLine) {
        // Mostra indicador de carregamento
        const popupContent = `<b>${name}</b><br>Calculando rota...`;
        const tempMarker = L.marker([lat, lng]).addTo(map)
            .bindPopup(popupContent).openPopup();

        try {
            const route = await getRouteDistance(originPos.lat, originPos.lng, lat, lng);
            if (route && route.source !== 'straight') {
                // Rota obtida com sucesso (cache ou online)
                const distanceKm = (route.distance / 1000).toFixed(2);
                const durationMin = route.duration ? Math.round(route.duration / 60) : '?';

                // Desenha a rota usando Leaflet Routing Machine
                window.routingControl = L.Routing.control({
                    waypoints: [
                        L.latLng(originPos.lat, originPos.lng),
                        L.latLng(lat, lng)
                    ],
                    routeWhileDragging: false,
                    showAlternatives: false,
                    addWaypoints: false,
                    fitSelectedRoutes: true
                }).addTo(map);

                // Quando a rota for encontrada, atualiza o popup
                window.routingControl.on('routesfound', function(e) {
                    const routeData = e.routes[0];
                    const dist = (routeData.summary.totalDistance / 1000).toFixed(2);
                    const dur = Math.round(routeData.summary.totalTime / 60);
                    const sourceLabel = route.source === 'cache' ? 'cache' : 'online';
                    map.removeLayer(tempMarker);
                    window.distanceMarker = L.marker([lat, lng]).addTo(map)
                        .bindPopup(`<b>${name}</b><br>🚗 Rota (${sourceLabel})<br>Distância: ${dist} km<br>Duração: ~${dur} min`)
                        .openPopup();
                });

                // Fallback se a rota falhar
                window.routingControl.on('routingerror', function() {
                    map.removeLayer(tempMarker);
                    drawStraightLine(originPos, lat, lng, name, distance);
                });

                return;
            } else {
                // Fallback: linha reta
                map.removeLayer(tempMarker);
                drawStraightLine(originPos, lat, lng, name, distance);
            }
        } catch (e) {
            console.warn('Erro ao obter rota:', e);
            drawStraightLine(originPos, lat, lng, name, distance);
        }
    } else {
        // Offline: linha reta
        drawStraightLine(originPos, lat, lng, name, distance);
    }
}

// Função auxiliar para desenhar linha reta (fallback)
function drawStraightLine(originPos, lat, lng, name, distance) {
    const latlngs = [[originPos.lat, originPos.lng], [lat, lng]];
    window.distanceLine = L.polyline(latlngs, { color: 'red', weight: 2, dashArray: '5,5' }).addTo(map);
    window.distanceMarker = L.marker([lat, lng]).addTo(map)
        .bindPopup(`<b>${name}</b><br>➡️ Linha reta<br>Distância: ${distance.toFixed(2)} km`)
        .openPopup();
    map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50] });
}

// Usar localização GPS
document.getElementById('useMyLocationBtn').addEventListener('click', () => {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(position => {
            const { latitude, longitude } = position.coords;
            setOrigin(latitude, longitude, 'Minha Localização');
            map.setView([latitude, longitude], 15);
            calculateDistancesToAllFeatures(latitude, longitude);
        }, error => {
            alert('Erro ao obter localização: ' + error.message);
        });
    } else {
        alert('Geolocalização não suportada.');
    }
});

// Listener do botão Selecionar Ponto no Mapa
document.getElementById('mapOriginBtn').addEventListener('click', () => {
    if (!mapClickMode) {
        mapClickMode = true;
        document.getElementById('mapOriginBtn').textContent = 'Clique no mapa para definir origem...';
        map.getContainer().style.cursor = 'crosshair';
    } else {
        mapClickMode = false;
        document.getElementById('mapOriginBtn').textContent = '🎯 Definir origem no mapa';
        map.getContainer().style.cursor = '';
    }
});

// Clique em feição para cálculo de distância
function handleFeatureClick(e, feature, layer) {

// Se o modo de seleção de origem estiver ativo, usa o clique para definir a origem
    if (mapClickMode) {
        // Desativa o modo
        mapClickMode = false;
        document.getElementById('mapOriginBtn').textContent = '🎯 Definir origem no mapa';
        map.getContainer().style.cursor = '';
        // Obtém as coordenadas do clique (e.latlng)
        const latlng = e.latlng;
        setOrigin(latlng.lat, latlng.lng, 'Origem manual (clique na feição)');
        map.setView([latlng.lat, latlng.lng], 15);
        calculateDistancesToAllFeatures(latlng.lat, latlng.lng);
        return; // Não processa mais a feição
    }

    // Se não há origem, define o ponto clicado como origem (apenas para pontos)
    if (!currentSearchResult && feature.geometry.type === 'Point') {
        const coords = feature.geometry.coordinates;
        setOrigin(coords[1], coords[0], feature.properties?.name || 'Ponto selecionado');
        map.setView([coords[1], coords[0]], 15);
        calculateDistancesToAllFeatures(coords[1], coords[0]);
        return;
    }

    if (!currentSearchResult) {
        alert('Defina um ponto de origem primeiro (busca ou localização).');
        return;
    }
    
    const origin = turf.point([currentSearchResult.lng, currentSearchResult.lat]);
    
    if (feature.geometry.type === 'Point') {
        const destinationPoint = turf.point(feature.geometry.coordinates);
        const distance = turf.distance(origin, destinationPoint, { units: 'kilometers' });
        
        const latlngs = [
            [currentSearchResult.lat, currentSearchResult.lng],
            [destinationPoint.geometry.coordinates[1], destinationPoint.geometry.coordinates[0]]
        ];
        
        // Remove elementos anteriores
        if (window.distanceLine) map.removeLayer(window.distanceLine);
        if (window.distanceMarker) map.removeLayer(window.distanceMarker);
        
        // Desenha linha e marcador
        window.distanceLine = L.polyline(latlngs, { color: 'red', weight: 2, dashArray: '5, 5' }).addTo(map);
        window.distanceMarker = L.marker([destinationPoint.geometry.coordinates[1], destinationPoint.geometry.coordinates[0]])
            .addTo(map)
            .bindPopup(`<b>${feature.properties?.name || 'Ponto'}</b><br>Distância: ${distance.toFixed(2)} km (${(distance*1000).toFixed(0)} m)`)
            .openPopup();
        
        // Ajusta a visualização para enquadrar origem e destino
        const bounds = L.latLngBounds(latlngs);
        map.fitBounds(bounds, { padding: [50, 50] });
    } else {
        // Para polígonos, apenas abre popup com nome (sem distância)
        const props = feature.properties || {};
        const name = props.name || 'Sem nome';
        layer.bindPopup(`<b>${name}</b>`).openPopup();
    }
}

// Indicador de status online/offline
function updateOnlineStatus() {
    const indicator = document.getElementById('status-indicator');
    if (navigator.onLine) {
        indicator.textContent = 'Online';
        indicator.className = 'status-indicator online';
    } else {
        indicator.textContent = 'Offline';
        indicator.className = 'status-indicator offline';
    }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// Configuração inicial
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    seedInitialData();
    loadStreetDataFromGitHub();
    setupAuth();
    setupFileUpload();
    setupDrawingTools();
    updateOnlineStatus();

// Verifica estado inicial da sidebar para esconder/mostrar o botão flutuante
const sidebar = document.getElementById('sidebar');
const showBtn = document.getElementById('sidebarShowBtn');
if (sidebar.classList.contains('collapsed')) {
    showBtn.classList.remove('hidden');
} else {
    showBtn.classList.add('hidden');
}
    
    // Sidebar toggle
    document.getElementById('sidebarToggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    // Mostra/esconde o botão flutuante
    const showBtn = document.getElementById('sidebarShowBtn');
    if (sidebar.classList.contains('collapsed')) {
        showBtn.classList.remove('hidden');
    } else {
        showBtn.classList.add('hidden');
    }
});
    // Botão flutuante (reabrir sidebar)
document.getElementById('sidebarShowBtn').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('collapsed');
    document.getElementById('sidebarShowBtn').classList.add('hidden');
});

    // Busca
    document.getElementById('searchBtn').addEventListener('click', () => {
        const query = document.getElementById('searchInput').value.trim();
        if (query) searchAddress(query);
    });
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = e.target.value.trim();
            if (query) searchAddress(query);
        }
    });

    // Listeners para checkboxes de visualização (comportamento de rádio)
    document.querySelectorAll('.view-checkbox').forEach(cb => {
        cb.addEventListener('change', function() {
            if (this.checked) {
                // Desmarca os outros
                document.querySelectorAll('.view-checkbox').forEach(other => {
                    if (other !== this) other.checked = false;
                });
                setViewMode(this.dataset.mode);
            } else {
                // Se o usuário desmarcar o único marcado, reativa 'all'
                const anyChecked = document.querySelector('.view-checkbox:checked');
                if (!anyChecked) {
                    document.querySelector('.view-checkbox[data-mode="all"]').checked = true;
                    setViewMode('all');
                }
            }
        });
    });

    // Inicializa sincronia com o viewMode atual (default 'all')
    syncViewCheckboxes(viewMode);
    
    // Registrar Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(registration => {
                    console.log('Service Worker registrado com sucesso:', registration.scope);
                })
                .catch(error => {
                    console.error('Falha ao registrar Service Worker:', error);
                });
        });
    }
});
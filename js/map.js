// js/map.js - Inicialização do mapa Leaflet, camada base com cache e cálculos de origem/distância

// Classe customizada de TileLayer com cache em IndexedDB
class OfflineTileLayer extends L.TileLayer {
    createTile(coords, done) {
        const tile = document.createElement('img');
        tile.alt = '';
        tile.setAttribute('role', 'presentation');
        
        const tileUrl = this.getTileUrl(coords);
        const tileKey = `${this._url}_${coords.z}_${coords.x}_${coords.y}`;
        
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
        center: [-15.7934, -47.8822],
        zoom: 4,
        zoomControl: false
    });

    L.control.zoom({ position: 'topright' }).addTo(map);
    
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

    baseLayer = new OfflineTileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });
    baseLayer.addTo(map);
    
    reloadLayers();
}

// Função resetAll - Limpa dados temporários e recupera vista inicial
function resetAll() {
    const searchResults = document.getElementById('searchResults');
    const distanceResults = document.getElementById('distanceResults');
    const searchInput = document.getElementById('searchInput');

    if (searchResults) searchResults.innerHTML = '';
    if (distanceResults) distanceResults.innerHTML = '';
    if (searchInput) searchInput.value = '';

    if (mapClickMode) {
        mapClickMode = false;
        const btn = document.getElementById('mapOriginBtn');
        if (btn) btn.textContent = '🎯 Definir origem no mapa';
        if (map) map.getContainer().style.cursor = '';
    }

    if (originMarker && map) {
        map.removeLayer(originMarker);
        originMarker = null;
    }
    if (window.distanceLine && map) {
        map.removeLayer(window.distanceLine);
        window.distanceLine = null;
    }
    if (window.distanceMarker && map) {
        map.removeLayer(window.distanceMarker);
        window.distanceMarker = null;
    }
    currentSearchResult = null;
    if (map) map.setView([-15.7934, -47.8822], 4);
    showToast('Campos e origem limpos.', 'info');
}
// Exporta globalmente para uso no app.js
window.resetAll = resetAll;

// Faz o enquadramento (fitBounds) de todas as feições carregadas no mapa
function zoomToAllFeatures() {
    let bounds = L.latLngBounds();
    let hasFeatures = false;
    
    Object.values(overlayLayers).forEach(layer => {
        if (map.hasLayer(layer)) {
            const layerBounds = layer.getBounds();
            if (layerBounds.isValid()) {
                bounds.extend(layerBounds);
                hasFeatures = true;
            }
        }
    });
    
    if (hasFeatures) {
        map.fitBounds(bounds, { padding: [50, 50] });
    } else {
        showToast('Nenhuma feição visível no mapa para enquadrar.', 'warning');
    }
}

// Define um ponto de origem para cálculo de distâncias
function setOrigin(lat, lng, description) {
    if (originMarker) map.removeLayer(originMarker);
    originMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    originMarker.bindPopup(`<b>Origem:</b> ${description}<br>Arraste para ajustar.`).openPopup();
    
    originMarker.on('dragend', (e) => {
        const newPos = e.target.getLatLng();
        calculateDistancesToAllFeatures(newPos.lat, newPos.lng);
    });
}

// Calcula distâncias da origem para todas as feições de ponto visíveis
async function calculateDistancesToAllFeatures(originLat, originLng) {
    const origin = turf.point([originLng, originLat]);
    const distances = [];

    const layers = await DB.getLayers();
    for (const layerData of layers) {
        // Apenas se a camada estiver visível no modo atual
        if (layerVisibility[layerData.id] === false) continue;
        if (!layerData.geojson) continue;

        for (const feature of layerData.geojson.features) {
            if (feature.geometry.type === 'Point') {
                const destination = turf.point(feature.geometry.coordinates);
                const distanceKm = turf.distance(origin, destination, { units: 'kilometers' });
                
                distances.push({
                    feature: feature,
                    distanceKm: distanceKm,
                    layerName: layerData.name
                });
            }
        }
    }

    // Ordena da menor para a maior distância
    distances.sort((a, b) => a.distanceKm - b.distanceKm);

    // Exibe os 10 resultados mais próximos na interface
    displayDistanceResults(distances.slice(0, 10));
}

function displayDistanceResults(results) {
    const resultsDiv = document.getElementById('distanceResults');
    if (!resultsDiv) return;
    resultsDiv.innerHTML = '<h4>Pontos Próximos</h4>';

    if (results.length === 0) {
        resultsDiv.innerHTML += '<p>Nenhum ponto encontrado.</p>';
        return;
    }

    results.forEach(item => {
        const div = document.createElement('div');
        div.className = 'distance-result-item';
        div.style.padding = '6px';
        div.style.marginBottom = '4px';
        div.style.background = '#f8f9fa';
        div.style.borderLeft = '3px solid #3498db';
        div.style.cursor = 'pointer';

        const name = item.feature.properties?.name || 'Ponto sem nome';
        const distFormatted = item.distanceKm < 1 
            ? `${(item.distanceKm * 1000).toFixed(0)} m` 
            : `${item.distanceKm.toFixed(2)} km`;

        div.innerHTML = `<b>${name}</b><br><small>${item.layerName} - ${distFormatted}</small>`;
        
        div.addEventListener('click', () => {
            const coords = item.feature.geometry.coordinates;
            map.setView([coords[1], coords[0]], 16);
            if (currentSearchResult) {
                drawRouteOrLine(item.feature);
            }
        });

        resultsDiv.appendChild(div);
    });
}

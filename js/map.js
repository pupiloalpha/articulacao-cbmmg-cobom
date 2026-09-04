// js/map.js - Inicialização do mapa Leaflet, camada base com cache e cálculos de origem/distância
// Inclui roteamento, verificação de polígonos e atualização de popup

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

// ===== FUNÇÕES RESGATADAS =====

// Verifica em quais polígonos (feature.type Polygon/MultiPolygon) o ponto está contido
async function checkPolygonContainment(lat, lng) {
    const point = turf.point([lng, lat]);
    const containingPolygons = [];

    // Itera sobre as camadas ativas no mapa (objeto overlayLayers)
    for (const layerId in overlayLayers) {
        const layerData = await DB.getLayerById(Number(layerId));
        if (!layerData || !layerData.geojson || !layerData.geojson.features) continue;

        for (const feature of layerData.geojson.features) {
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

// Atualiza o popup do marcador de origem com informações de polígonos
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

// Obtém distância por rota (com cache e fallback)
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
    return {
        distance: straightDistance,
        duration: null,
        source: 'straight'
    };
}

// Desenha linha reta (fallback)
function drawStraightLine(originPos, lat, lng, name, distance) {
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

    const latlngs = [[originPos.lat, originPos.lng], [lat, lng]];
    window.distanceLine = L.polyline(latlngs, { color: 'red', weight: 2, dashArray: '5,5' }).addTo(map);
    window.distanceMarker = L.marker([lat, lng]).addTo(map)
        .bindPopup(`<b>${name}</b><br>➡️ Linha reta<br>Distância: ${(distance/1000).toFixed(2)} km`)
        .openPopup();
    map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50] });
}

// Foca em uma feature e tenta desenhar rota (ou linha reta)
async function focusOnFeature(lng, lat, name, distance) {
    if (!originMarker) {
        showToast('Defina uma origem primeiro.', 'warning');
        return;
    }
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
        const tempMarker = L.marker([lat, lng]).addTo(map)
            .bindPopup(`<b>${name}</b><br>Calculando rota...`).openPopup();

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

// ===== FUNÇÕES EXISTENTES (com ajustes) =====

// Define um ponto de origem para cálculo de distâncias
function setOrigin(lat, lng, description) {
    if (originMarker) map.removeLayer(originMarker);
    originMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    originMarker.bindPopup(`<b>Origem:</b> ${description}`).openPopup();
    
    // Atualiza currentOrigin (global) e o popup com polígonos
    currentOrigin = { lat, lng, description };
    updateOriginPopup(lat, lng, description);
    
    originMarker.on('dragend', (e) => {
        const newPos = e.target.getLatLng();
        currentOrigin = { lat: newPos.lat, lng: newPos.lng, description };
        calculateDistancesToAllFeatures(newPos.lat, newPos.lng);
        updateOriginPopup(newPos.lat, newPos.lng, description);
    });
    
    calculateDistancesToAllFeatures(lat, lng);
}

// Calcula distâncias da origem para todas as feições de ponto visíveis
async function calculateDistancesToAllFeatures(originLat, originLng) {
    const origin = turf.point([originLng, originLat]);
    const distances = [];

    const layers = await DB.getLayers();
    for (const layerData of layers) {
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

    distances.sort((a, b) => a.distanceKm - b.distanceKm);
    displayDistanceResults(distances.slice(0, 10));
}

// Exibe os resultados de distância e permite focar na feature
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
            const coords = item.feature.geometry.coordinates; // [lng, lat]
            // Usa focusOnFeature para desenhar rota ou linha
            focusOnFeature(coords[0], coords[1], name, item.distanceKm);
        });

        resultsDiv.appendChild(div);
    });
}

// Função principal para desenhar rota/linha a partir de uma feature clicada
function drawRouteOrLine(feature) {
    if (!originMarker) {
        showToast('Defina uma origem primeiro.', 'warning');
        return;
    }
    // Extrai coordenadas representativas (para LineString, pega o ponto médio; para Point, o próprio)
    let coords = null;
    const geom = feature.geometry;
    if (geom.type === 'Point') {
        coords = geom.coordinates;
    } else if (geom.type === 'LineString' || geom.type === 'MultiLineString') {
        // Pega o primeiro ponto da linha (ou o médio)
        const line = geom.type === 'LineString' ? geom.coordinates : geom.coordinates[0];
        if (line && line.length) {
            const mid = Math.floor(line.length / 2);
            coords = line[mid] || line[0];
        }
    } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
        // Para polígonos, apenas abre popup com nome (sem rota)
        const props = feature.properties || {};
        const name = props.name || 'Sem nome';
        showToast(`Clique em ${name} (polígono) – rota não disponível.`, 'info');
        // Cria um marcador temporário no centro aproximado
        const center = turf.center(turf.feature(geom));
        const centerCoords = center.geometry.coordinates;
        L.marker([centerCoords[1], centerCoords[0]])
            .addTo(map)
            .bindPopup(`<b>${name}</b><br>(Polígono)`)
            .openPopup();
        return;
    } else {
        showToast('Tipo de geometria não suportado para rota.', 'warning');
        return;
    }

    if (coords) {
        const name = feature.properties?.name || 'Ponto selecionado';
        // distance estimada (será recalculada pela rota)
        const originPos = originMarker.getLatLng();
        const from = turf.point([originPos.lng, originPos.lat]);
        const to = turf.point(coords);
        const dist = turf.distance(from, to, { units: 'kilometers' });
        focusOnFeature(coords[0], coords[1], name, dist);
    }
}
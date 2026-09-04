// js/map.js - Inicialização do mapa Leaflet, camada base com cache e cálculos de origem/distância
// Inclui roteamento, verificação de polígonos, popup dinâmico e painel de distâncias em linha reta

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
        center: [-15.7934, -47.8822], // Brasília, Brasil
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

    baseLayer = new OfflineTileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });
    baseLayer.addTo(map);
    
    reloadLayers();
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

// Faz o enquadramento (fitBounds) de todas as feições carregadas no mapa
function zoomToAllFeatures() {
    const bounds = new L.LatLngBounds();
    let hasFeatures = false;

    for (const layerId in overlayLayers) {
        const layer = overlayLayers[layerId];
        if (!map.hasLayer(layer)) continue;
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
        map.setView([-15.7934, -47.8822], 4);
    }
}

// Verifica em quais polígonos (feature.type Polygon/MultiPolygon) o ponto está contido
async function checkPolygonContainment(lat, lng) {
    const point = turf.point([lng, lat]);
    const containingPolygons = [];

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
        originMarker.openPopup();
    }
}

// Define um ponto de origem para cálculo de distâncias
function setOrigin(lat, lng, description) {
    if (originMarker) map.removeLayer(originMarker);
    originMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    originMarker.bindPopup(`<b>Origem:</b> ${description}<br>Arraste para ajustar.`).openPopup();
    
    updateOriginPopup(lat, lng, description);
    
    originMarker.on('dragend', () => {
        const pos = originMarker.getLatLng();
        currentSearchResult = { lat: pos.lat, lng: pos.lng, address: description };
        calculateDistancesToAllFeatures(pos.lat, pos.lng);
        updateOriginPopup(pos.lat, pos.lng, description);
    });
    
    currentSearchResult = { lat, lng, address: description };
}

// Função para calcular e exibir distâncias (em linha reta e contenção em polígonos)
async function calculateDistancesToAllFeatures(originLat, originLng) {
    const distanceContainer = document.getElementById('distanceResults');
    if (!distanceContainer) return;

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
                         onclick="focusOnFeature(${res.destination[0]}, ${res.destination[1]}, '${res.featureName.replace(/'/g, "\\'")}', ${res.distanceKm})">
                        <strong>${res.featureName}</strong> (${res.layerName})<br>
                        <span style="color:#c0392b;">${km} km (${m} m)</span>
                        <span style="font-size:0.8em; color:#666; margin-left:8px;">➡️ linha reta</span>
                    </li>`;
        }
        html += '</ul>';
    }

    distanceContainer.innerHTML = html;
}

// Obtém distância por rota (com cache OSRM e fallback)
async function getRouteDistance(originLat, originLng, destLat, destLng) {
    const cached = await DB.getRouteFromCache(originLat, originLng, destLat, destLng);
    if (cached) {
        return {
            distance: cached.distance,
            duration: cached.duration,
            source: 'cache'
        };
    }

    if (navigator.onLine) {
        try {
            const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=false`;
            const response = await fetch(url);
            const data = await response.json();
            if (data.code === 'Ok') {
                const distance = data.routes[0].distance;
                const duration = data.routes[0].duration;
                await DB.saveRouteToCache(originLat, originLng, destLat, destLng, distance, duration);
                return { distance, duration, source: 'online' };
            }
        } catch (e) {
            console.warn('Falha ao obter rota online:', e);
        }
    }

    const from = turf.point([originLng, originLat]);
    const to = turf.point([destLng, destLat]);
    const straightDistance = turf.distance(from, to, { units: 'kilometers' }) * 1000;
    return {
        distance: straightDistance,
        duration: null,
        source: 'straight'
    };
}

// Desenha linha reta (fallback)
function drawStraightLine(originPos, lat, lng, name, distance) {
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
        .bindPopup(`<b>${name}</b><br>➡️ Linha reta<br>Distância: ${distance.toFixed(2)} km`)
        .openPopup();
    map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50] });
}

// Foca em uma feature e desenha rota (ou linha reta)
async function focusOnFeature(lng, lat, name, distance) {
    if (!originMarker) return;
    const originPos = originMarker.getLatLng();

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

    if (navigator.onLine) {
        const popupContent = `<b>${name}</b><br>Calculando rota...`;
        const tempMarker = L.marker([lat, lng]).addTo(map)
            .bindPopup(popupContent).openPopup();

        try {
            const route = await getRouteDistance(originPos.lat, originPos.lng, lat, lng);
            if (route && route.source !== 'straight') {
                const distanceKm = (route.distance / 1000).toFixed(2);
                const durationMin = route.duration ? Math.round(route.duration / 60) : '?';

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

                window.routingControl.on('routingerror', function() {
                    map.removeLayer(tempMarker);
                    drawStraightLine(originPos, lat, lng, name, distance);
                });

                return;
            } else {
                map.removeLayer(tempMarker);
                drawStraightLine(originPos, lat, lng, name, distance);
            }
        } catch (e) {
            console.warn('Erro ao obter rota:', e);
            drawStraightLine(originPos, lat, lng, name, distance);
        }
    } else {
        drawStraightLine(originPos, lat, lng, name, distance);
    }
}
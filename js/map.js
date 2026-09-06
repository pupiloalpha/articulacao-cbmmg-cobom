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

    // Remove os caminhos padrão defeituosos
delete L.Icon.Default.prototype._getIconUrl;

// Força o recarregamento dos ícones a partir de uma CDN confiável
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
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
    
    // REMOVIDO para evitar ReferenceError: reloadLayers();
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

// Controle de requisições assíncronas de rota para evitar condições de corrida
let currentRouteRequestId = 0;

// Função para calcular e exibir distâncias (Jurisdição COBOM + Top Candidatas + ETA Assíncrono)
async function calculateDistancesToAllFeatures(originLat, originLng) {
    const distanceContainer = document.getElementById('distanceResults');
    if (!distanceContainer) return;

    // Incrementa token para descartar respostas de requisições anteriores
    const reqId = ++currentRouteRequestId;

    // 1. Verifica polígonos que contêm o ponto (Jurisdição Territorial)
    const containingPolygons = await checkPolygonContainment(originLat, originLng);
    
    // 2. Calcula distâncias em linha reta para todas as unidades operacionais (excluindo municípios)
    const originPoint = turf.point([originLng, originLat]);
    const results = [];

    for (const layerId in overlayLayers) {
        const layerData = await DB.getLayerById(Number(layerId));
        if (!layerData || !layerData.geojson) continue;

        for (const feature of layerData.geojson.features) {
            if (feature.geometry.type !== 'Point') continue;

            // Ignora pontos de municípios para calcular distância somente até Unidades/Frações BM
            if (typeof getFeatureClassification === 'function' && getFeatureClassification(feature) === 'MUNICIPIO') {
                continue;
            }

            const coords = feature.geometry.coordinates;
            const destPoint = turf.point(coords);
            const distanceKm = turf.distance(originPoint, destPoint, { units: 'kilometers' });

            const props = feature.properties || {};
            const subtitle = props.UEOP ? ` • ${props.UEOP}` : (props.layerName ? ` • ${props.layerName}` : '');

            results.push({
                layerName: layerData.name,
                featureName: feature.properties?.name || 'Unidade BM',
                subtitle: subtitle,
                distanceKm: distanceKm,
                destination: coords,
                source: 'straight'
            });
        }
    }

    // Ordena por proximidade euclidiana e seleciona Top 5
    results.sort((a, b) => a.distanceKm - b.distanceKm);
    const topResults = results.slice(0, 5);

    // Constrói HTML do Painel de Despacho Operacional
    let html = '<div class="dispatch-panel">';

    // Card de Jurisdição Territorial
    let jurisdictionHtml = '';
    if (containingPolygons.length > 0) {
        jurisdictionHtml = containingPolygons.map(p => `🛡️ ${p.featureName} <small style="opacity:0.8">(${p.layerName})</small>`).join('<br>');
    } else {
        jurisdictionHtml = '<span style="color:#e74c3c; font-weight:normal;">⚠️ Fora de polígonos mapeados (ou divisa intermunicipal)</span>';
    }

    html += `
        <div class="dispatch-jurisdiction-card">
            <div class="dispatch-jurisdiction-title">🚨 Jurisdição Territorial Responsável</div>
            <div class="dispatch-jurisdiction-name">${jurisdictionHtml}</div>
        </div>
    `;

    // Lista de Unidades BM Próximas
    if (topResults.length === 0) {
        html += '<p style="padding:10px; font-size:12px; color:#666;">Nenhuma unidade de bombeiros encontrada nas camadas carregadas.</p>';
    } else {
        html += `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
                <span style="font-size:12px; font-weight:700; color:#2c3e50;">🚒 Unidades Candidatas ao Despacho:</span>
                <span style="font-size:10px; color:#7f8c8d;">1-clique para traçar rota</span>
            </div>
            <div class="dispatch-units-list">
        `;

        topResults.forEach((res, i) => {
            const straightKm = res.distanceKm.toFixed(2);
            const sub = res.subtitle ? res.subtitle.replace(/^ • /, '') : res.layerName;
            const initialBadge = i < 3 
                ? `<span class="eta-badge-loading" id="eta-badge-unit-${i}">⏱️ Calculando tempo...</span>`
                : `<span class="eta-badge-straight" id="eta-badge-unit-${i}">➡️ ${straightKm} km (reta)</span>`;

            html += `
                <div class="dispatch-unit-card" id="dispatch-unit-card-${i}"
                     onclick="focusOnFeature(${res.destination[0]}, ${res.destination[1]}, '${res.featureName.replace(/'/g, "\\'")}', ${res.distanceKm})">
                    <div class="dispatch-unit-header">
                        <div class="dispatch-unit-name">
                            <span class="dispatch-unit-rank">#${i + 1}</span> ${res.featureName}
                        </div>
                    </div>
                    <div class="dispatch-unit-details">
                        <span>${sub}</span>
                        <div id="eta-container-unit-${i}">${initialBadge}</div>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
    }

    html += '</div>';
    distanceContainer.innerHTML = html;

    // Dispara cálculo assíncrono em segundo plano para as Top 3 unidades (não-bloqueante)
    if (topResults.length > 0) {
        fetchTopRoutesAsync(originLat, originLng, topResults, reqId);
    }
}

// Busca rotas e tempos de resposta (ETA) em paralelo para as Top 3 candidatas
async function fetchTopRoutesAsync(originLat, originLng, topResults, reqId) {
    const candidatesToRoute = topResults.slice(0, 3);
    const routePromises = candidatesToRoute.map((cand, index) => {
        return getRouteDistance(originLat, originLng, cand.destination[1], cand.destination[0])
            .then(route => ({ index, cand, route }))
            .catch(err => ({ index, cand, error: err }));
    });

    const settled = await Promise.allSettled(routePromises);

    // Se o usuário já mudou o ponto ou realizou outra busca, ignora resultado obsoleto
    if (reqId !== currentRouteRequestId) return;

    let bestIndex = -1;
    let minDuration = Infinity;

    settled.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
            const { index, cand, route } = result.value;
            const container = document.getElementById(`eta-container-unit-${index}`);
            if (!container) return;

            if (route && route.duration !== null && route.duration !== undefined) {
                cand.route = route;
                const durMin = Math.round(route.duration / 60);
                const distKm = (route.distance / 1000).toFixed(1);
                container.innerHTML = `<span class="eta-badge-ready" id="eta-badge-unit-${index}">🚗 ~${durMin} min (${distKm} km)</span>`;

                if (route.duration < minDuration) {
                    minDuration = route.duration;
                    bestIndex = index;
                }
            } else {
                const km = cand.distanceKm.toFixed(2);
                container.innerHTML = `<span class="eta-badge-straight" id="eta-badge-unit-${index}">➡️ ${km} km (reta)</span>`;
            }
        }
    });

    // Destaque visual para a unidade com o melhor tempo de resposta (ETA)
    if (bestIndex >= 0 && minDuration !== Infinity) {
        const bestCard = document.getElementById(`dispatch-unit-card-${bestIndex}`);
        const bestContainer = document.getElementById(`eta-container-unit-${bestIndex}`);
        if (bestCard) bestCard.classList.add('card-best-eta');
        if (bestContainer) {
            const bestCandidate = candidatesToRoute[bestIndex];
            const durMin = Math.round(bestCandidate.route.duration / 60);
            const distKm = (bestCandidate.route.distance / 1000).toFixed(1);
            bestContainer.innerHTML = `<span class="eta-badge-best" id="eta-badge-unit-${bestIndex}">⭐ Mais rápido: ~${durMin} min (${distKm} km)</span>`;
        }
    }
}

// Obtém distância por rota (com timeout de 4s, cache OSRM em IndexedDB e fallback)
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout para não travar
        try {
            const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=false`;
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            const data = await response.json();
            if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                const distance = data.routes[0].distance;
                const duration = data.routes[0].duration;
                await DB.saveRouteToCache(originLat, originLng, destLat, destLng, distance, duration);
                return { distance, duration, source: 'online' };
            }
        } catch (e) {
            clearTimeout(timeoutId);
            // Ignora falha de rede/timeout silenciosamente para fallback
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

// Desenha linha reta (fallback visual para offline ou ausência de malha viária)
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
    window.distanceLine = L.polyline(latlngs, { color: '#e74c3c', weight: 3, dashArray: '6,6' }).addTo(map);
    window.distanceMarker = L.marker([lat, lng]).addTo(map)
        .bindPopup(`<b>${name}</b><br>➡️ Linha reta (offline)<br>Distância: ${distance.toFixed(2)} km`)
        .openPopup();
    map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50] });
}

// Foca em uma unidade BM selecionada e desenha o traçado da rota no mapa sob demanda
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
        const popupContent = `<b>${name}</b><br>🚗 Carregando traçado da rota...`;
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
                    fitSelectedRoutes: true,
                    lineOptions: {
                        styles: [{ color: '#e74c3c', weight: 5, opacity: 0.85 }]
                    }
                }).addTo(map);

                window.routingControl.on('routesfound', function(e) {
                    const routeData = e.routes[0];
                    const dist = (routeData.summary.totalDistance / 1000).toFixed(2);
                    const dur = Math.round(routeData.summary.totalTime / 60);
                    const sourceLabel = route.source === 'cache' ? 'cache local' : 'tempo real';
                    map.removeLayer(tempMarker);
                    window.distanceMarker = L.marker([lat, lng]).addTo(map)
                        .bindPopup(`
                            <div style="font-family:sans-serif;">
                                <b style="color:#c0392b; font-size:13px;">🚒 ${name}</b><br>
                                <div style="margin-top:4px; font-size:12px;">
                                    <b>Tempo estimado:</b> ~${dur} min<br>
                                    <b>Distância por via:</b> ${dist} km<br>
                                    <span style="font-size:10px; color:#7f8c8d;">Fonte: ${sourceLabel}</span>
                                </div>
                            </div>
                        `)
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
            if (tempMarker) map.removeLayer(tempMarker);
            drawStraightLine(originPos, lat, lng, name, distance);
        }
    } else {
        drawStraightLine(originPos, lat, lng, name, distance);
    }
}

// Helpers globais para ações acionadas a partir dos popups de feições
window.setOriginFromFeature = function(lat, lng, name) {
    if (map) {
        setOrigin(lat, lng, name);
        map.setView([lat, lng], 14);
        calculateDistancesToAllFeatures(lat, lng);
        showToast(`Origem definida: ${name}`, 'success');
    }
};

window.routeToFeature = function(lng, lat, name) {
    if (!originMarker) {
        showToast('Defina primeiro um ponto de origem (busca, GPS ou clique) para calcular a rota.', 'warning');
        return;
    }
    const originPos = originMarker.getLatLng();
    const from = turf.point([originPos.lng, originPos.lat]);
    const to = turf.point([lng, lat]);
    const distance = turf.distance(from, to, { units: 'kilometers' });
    focusOnFeature(lng, lat, name, distance);
};

window.copyFeatureCoords = function(lat, lng) {
    const text = `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(`Coordenadas copiadas: ${text}`, 'info');
        }).catch(() => {
            showToast(`Coordenadas: ${text}`, 'info');
        });
    } else {
        showToast(`Coordenadas: ${text}`, 'info');
    }
};

window.zoomToCoords = function(lat, lng, zoomLevel = 15) {
    if (map) {
        map.setView([lat, lng], zoomLevel);
    }
};


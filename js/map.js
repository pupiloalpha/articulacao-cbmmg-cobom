// js/map.js - Mapa Leaflet + cálculo de distâncias (sempre com todas as camadas do banco)

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
                tile.onload = () => { URL.revokeObjectURL(objectURL); done(null, tile); };
                tile.onerror = () => { URL.revokeObjectURL(objectURL); this._fetchFromNetwork(tileUrl, tileKey, tile, done); };
            } else {
                this._fetchFromNetwork(tileUrl, tileKey, tile, done);
            }
        }).catch(() => this._fetchFromNetwork(tileUrl, tileKey, tile, done));
        return tile;
    }

    _fetchFromNetwork(url, key, tile, done) {
        fetch(url).then(r => {
            if (!r.ok) throw new Error('Network error');
            return r.blob();
        }).then(blob => {
            DB.saveTile(key, blob).catch(() => {});
            const objectURL = URL.createObjectURL(blob);
            tile.src = objectURL;
            tile.onload = () => { URL.revokeObjectURL(objectURL); done(null, tile); };
            tile.onerror = () => { URL.revokeObjectURL(objectURL); done(new Error('Tile load fail'), tile); };
        }).catch(err => done(err, tile));
    }
}

function initMap() {
    map = L.map('map', { center: [-15.7934, -47.8822], zoom: 4, zoomControl: false });
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png'
    });
    L.control.zoom({ position: 'topright' }).addTo(map);

    L.Control.ZoomExtended = L.Control.extend({
        onAdd: function () {
            const btn = L.DomUtil.create('button', 'leaflet-control-zoom-extended');
            btn.innerHTML = '⤡';
            btn.title = 'Zoom para todas as feições';
            L.DomEvent.on(btn, 'click', e => { L.DomEvent.stopPropagation(e); zoomToAllFeatures(); });
            return btn;
        }
    });

    L.control.zoomExtended = function (opts) {
              return new L.Control.ZoomExtended(opts);
          };

    L.control.zoomExtended({ position: 'topright' }).addTo(map);

    map.on('dblclick', () => map.closePopup());
    map.on('click', e => {
        if (mapClickMode) {
            mapClickMode = false;
            const btn = document.getElementById('mapOriginBtn');
            if (btn) btn.textContent = '🎯 Ponto no Mapa';
            map.getContainer().style.cursor = '';
            setOrigin(e.latlng.lat, e.latlng.lng, 'Origem manual');
            map.setView([e.latlng.lat, e.latlng.lng], 15);
            calculateDistancesToAllFeatures(e.latlng.lat, e.latlng.lng);
        }
    });

    baseLayer = new OfflineTileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });
    baseLayer.addTo(map);
}

function extractCoordinates(geometry) {
    const coords = [];
    if (geometry.type === 'Point') coords.push([geometry.coordinates[1], geometry.coordinates[0]]);
    else if (geometry.type === 'MultiPoint') geometry.coordinates.forEach(c => coords.push([c[1], c[0]]));
    else if (geometry.type === 'LineString') geometry.coordinates.forEach(c => coords.push([c[1], c[0]]));
    else if (geometry.type === 'MultiLineString') geometry.coordinates.forEach(line => line.forEach(c => coords.push([c[1], c[0]])));
    else if (geometry.type === 'Polygon') geometry.coordinates[0].forEach(c => coords.push([c[1], c[0]]));
    else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach(poly => poly[0].forEach(c => coords.push([c[1], c[0]])));
    else if (geometry.type === 'GeometryCollection') geometry.geometries.forEach(g => coords.push(...extractCoordinates(g)));
    return coords;
}

function zoomToAllFeatures() {
    const bounds = new L.LatLngBounds();
    let hasFeatures = false;
    for (const layerId in overlayLayers) {
        const layer = overlayLayers[layerId];
        if (!map.hasLayer(layer)) continue;
        layer.eachLayer(l => {
            if (l.feature?.geometry) {
                extractCoordinates(l.feature.geometry).forEach(c => { bounds.extend(c); hasFeatures = true; });
            }
        });
    }
    if (hasFeatures) map.fitBounds(bounds, { padding: [50, 50] });
    else map.setView([-15.7934, -47.8822], 4);
}

async function checkPolygonContainment(lat, lng) {
    const point = turf.point([lng, lat]);
    const containingPolygons = [];
    const allLayers = await DB.getLayers();

    for (const layerData of allLayers) {
        if (!layerData?.geojson?.features) continue;
        for (const feature of layerData.geojson.features) {
            if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue;
            try {
                const polygonFeature = turf.feature(feature.geometry);
                if (!turf.booleanPointInPolygon(point, polygonFeature)) continue;

                const classification = typeof getFeatureClassification === 'function' ? getFeatureClassification(feature) : null;
                let featureName = 'Sem nome';

                if (classification === 'MACRORREGIAO') {
                    featureName = feature.properties?.Macrorregiao_Saude ||
                        feature.properties?.['Regionalização pop. 2025 — RegionalizaçãoMG2025_Macrorregião de Saúde'] ||
                        feature.properties?.['Macrorregião de Saúde'] || feature.properties?.name || 'Macrorregião';
                } else if (classification === 'MICRORREGIAO') {
                    featureName = feature.properties?.['Regionalização pop. 2025 — RegionalizaçãoMG2025_Microrregião de Saúde'] ||
                        feature.properties?.['Microrregião de Saúde'] || feature.properties?.NM_RGI || feature.properties?.name || 'Microrregião';
                } else {
                    featureName = feature.properties?.name || feature.properties?.NM_MUN || feature.properties?.Field3 || 'Sem nome';
                }

                containingPolygons.push({
                    layerName: layerData.name,
                    featureName,
                    classification
                });
            } catch (e) {
                console.warn('Erro contenção polígono:', e);
            }
        }
    }
    return containingPolygons;
}

async function updateOriginPopup(lat, lng, description) {
    const containingPolygons = await checkPolygonContainment(lat, lng);
    let popupContent = `<b>Origem:</b> ${description}<br>`;
    if (containingPolygons.length > 0) {
        popupContent += `<b>Dentro de:</b> ${containingPolygons.map(p => p.featureName).join(', ')}<br>`;
    } else {
        popupContent += 'Não está dentro de nenhum polígono.<br>';
    }
    popupContent += 'Arraste para ajustar.';
    if (originMarker) {
        originMarker.setPopupContent(popupContent);
        originMarker.openPopup();
    }
}

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

let currentRouteRequestId = 0;

async function calculateDistancesToAllFeatures(originLat, originLng) {
    const distanceContainer = document.getElementById('distanceResults');
    if (!distanceContainer) return;

    const reqId = ++currentRouteRequestId;
    const containingPolygons = await checkPolygonContainment(originLat, originLng);
    const originPoint = turf.point([originLng, originLat]);
    const unitResults = [];
    const hospitalResults = [];

    // ===== SEMPRE usa TODAS as camadas do banco (independente de visibilidade) =====
    const allLayers = await DB.getLayers();
    for (const layerData of allLayers) {
        if (!layerData?.geojson?.features) continue;
        for (const feature of layerData.geojson.features) {
            if (feature.geometry.type !== 'Point') continue;
            const classification = typeof getFeatureClassification === 'function' ? getFeatureClassification(feature) : 'OTHER';
            if (classification === 'MUNICIPIO') continue;

            const coords = feature.geometry.coordinates;
            const distanceKm = turf.distance(originPoint, turf.point(coords), { units: 'kilometers' });
            const props = feature.properties || {};
            const name = props.name || props['Nome do Hospital'] || 'Ponto';

            const item = {
                layerName: layerData.name,
                featureName: name,
                distanceKm,
                destination: coords,
                classification,
                subtitle: ''
            };

            if (classification === 'HOSPITAL') {
                item.subtitle = props.Município || props.Municipio || props['Macrorregião de Saúde'] || layerData.name;
                hospitalResults.push(item);
            } else if (classification === 'UNIDADE_BM') {
                item.subtitle = props.UEOP || props.COB || layerData.name;
                unitResults.push(item);
            }
        }
    }

    unitResults.sort((a, b) => a.distanceKm - b.distanceKm);
    hospitalResults.sort((a, b) => a.distanceKm - b.distanceKm);

    const topUnits = unitResults.slice(0, 10);          // 10 unidades
    const topHospitals = hospitalResults.slice(0, 3);  // 3 hospitais

    // ===== HTML do painel =====
    let html = '<div class="dispatch-panel">';

    // Jurisdição
    let jurisdictionHtml = '';
    if (containingPolygons.length > 0) {
        jurisdictionHtml = containingPolygons.map(p => {
            const isBM = p.layerName && (
                p.layerName.toLowerCase().includes('articula') ||
                p.layerName.toLowerCase().includes('cbmmg') ||
                p.layerName.toLowerCase().includes('bombeiro')
            );
            const itemClass = isBM ? 'jurisdiction-item jurisdiction-bm' : 'jurisdiction-item';
            const icon = isBM ? '🚒' : '🛡️';
            return `
                <div class="${itemClass}">
                    <span class="jurisdiction-icon">${icon}</span>
                    <div class="jurisdiction-text">
                        <span class="jurisdiction-name">${p.featureName}</span>
                        <small class="jurisdiction-layer">(${p.layerName})</small>
                    </div>
                    ${isBM ? '<span class="jurisdiction-badge-bm">BM</span>' : ''}
                </div>`;
        }).join('');
    } else {
        jurisdictionHtml = `
            <div class="jurisdiction-item jurisdiction-empty">
                <span class="jurisdiction-icon">⚠️</span>
                <div class="jurisdiction-text"><span class="jurisdiction-name">Fora de polígonos mapeados</span></div>
            </div>`;
    }

    html += `
        <div class="dispatch-jurisdiction-card">
            <div class="dispatch-jurisdiction-title">🚨 Responsabilidade Territorial</div>
            <div class="dispatch-jurisdiction-list">${jurisdictionHtml}</div>
        </div>`;

    // ===== Unidades BM (Top 10) =====
    html += `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
            <span style="font-size:12px; font-weight:700; color:#2c3e50;">🚒 Unidades BM mais próximas (Top 10)</span>
            <span style="font-size:10px; color:#7f8c8d;">clique para rota</span>
        </div>
        <div class="dispatch-units-list">`;

    if (topUnits.length === 0) {
        html += '<p style="padding:8px; font-size:12px; color:#666;">Nenhuma unidade BM encontrada.</p>';
    } else {
        topUnits.forEach((res, i) => {
            const straightKm = res.distanceKm.toFixed(2);
            const isTop3 = i < 3;
            const initialBadge = isTop3
                ? `<span class="eta-badge-loading" id="eta-badge-unit-${i}">⏱️ Calculando...</span>`
                : `<span class="eta-badge-straight">➡️ ${straightKm} km (reta)</span>`;

            html += `
                <div class="dispatch-unit-card" id="dispatch-unit-card-${i}"
                     onclick="focusOnFeature(${res.destination[0]}, ${res.destination[1]}, '${res.featureName.replace(/'/g, "\\'")}', ${res.distanceKm})">
                    <div class="dispatch-unit-header">
                        <div class="dispatch-unit-name">
                            <span class="dispatch-unit-rank">#${i + 1}</span> ${res.featureName}
                        </div>
                    </div>
                    <div class="dispatch-unit-details">
                        <span>${res.subtitle}</span>
                        <div id="eta-container-unit-${i}">${initialBadge}</div>
                    </div>
                </div>`;
        });
    }
    html += `</div>`;

    // ===== Hospitais (Top 3) =====
    html += `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px;">
            <span style="font-size:12px; font-weight:700; color:#2c3e50;">🏥 Hospitais de Referência (Top 3)</span>
            <span style="font-size:10px; color:#7f8c8d;">clique para rota</span>
        </div>
        <div class="dispatch-units-list">`;

    if (topHospitals.length === 0) {
        html += '<p style="padding:8px; font-size:12px; color:#666;">Nenhum hospital encontrado.</p>';
    } else {
        topHospitals.forEach((res, i) => {
            const straightKm = res.distanceKm.toFixed(2);
            const initialBadge = `<span class="eta-badge-loading" id="eta-badge-hosp-${i}">⏱️ Calculando...</span>`;
            html += `
                <div class="dispatch-unit-card" id="dispatch-hosp-card-${i}"
                     onclick="focusOnFeature(${res.destination[0]}, ${res.destination[1]}, '${res.featureName.replace(/'/g, "\\'")}', ${res.distanceKm})">
                    <div class="dispatch-unit-header">
                        <div class="dispatch-unit-name">
                            <span class="dispatch-unit-rank">#${i + 1}</span> ${res.featureName}
                        </div>
                    </div>
                    <div class="dispatch-unit-details">
                        <span>${res.subtitle}</span>
                        <div id="eta-container-hosp-${i}">${initialBadge}</div>
                    </div>
                </div>`;
        });
    }
    html += `</div></div>`;

    distanceContainer.innerHTML = html;

    // Dispara cálculo de rotas apenas para Top 3 BM + Top 3 Hospitais
    if (topUnits.length > 0 || topHospitals.length > 0) {
        fetchTopRoutesAsync(originLat, originLng, topUnits.slice(0, 3), topHospitals, reqId);
    }
}

async function fetchTopRoutesAsync(originLat, originLng, topUnits, topHospitals, reqId) {
    const allCandidates = [
        ...topUnits.map((cand, index) => ({ type: 'unit', index, cand })),
        ...topHospitals.map((cand, index) => ({ type: 'hosp', index, cand }))
    ];

    const routePromises = allCandidates.map(({ type, index, cand }) =>
        getRouteDistance(originLat, originLng, cand.destination[1], cand.destination[0])
            .then(route => ({ type, index, cand, route }))
            .catch(err => ({ type, index, cand, error: err }))
    );

    const settled = await Promise.allSettled(routePromises);
    if (reqId !== currentRouteRequestId) return;

    let bestUnitIndex = -1, minUnitDuration = Infinity;
    let bestHospIndex = -1, minHospDuration = Infinity;

    settled.forEach(result => {
        if (result.status !== 'fulfilled' || !result.value) return;
        const { type, index, cand, route } = result.value;
        const containerId = type === 'unit' ? `eta-container-unit-${index}` : `eta-container-hosp-${index}`;
        const container = document.getElementById(containerId);
        if (!container) return;

        if (route && route.duration != null) {
            cand.route = route;
            const durMin = Math.round(route.duration / 60);
            const distKm = (route.distance / 1000).toFixed(1);
            container.innerHTML = `<span class="eta-badge-ready">🚗 ~${durMin} min (${distKm} km)</span>`;

            if (type === 'unit' && route.duration < minUnitDuration) {
                minUnitDuration = route.duration;
                bestUnitIndex = index;
            }
            if (type === 'hosp' && route.duration < minHospDuration) {
                minHospDuration = route.duration;
                bestHospIndex = index;
            }
        } else {
            const km = cand.distanceKm.toFixed(2);
            container.innerHTML = `<span class="eta-badge-straight">➡️ ${km} km (reta)</span>`;
        }
    });

    // Destaque melhor ETA – Unidades
    if (bestUnitIndex >= 0) {
        const bestCard = document.getElementById(`dispatch-unit-card-${bestUnitIndex}`);
        const bestContainer = document.getElementById(`eta-container-unit-${bestUnitIndex}`);
        if (bestCard) bestCard.classList.add('card-best-eta');
        if (bestContainer && topUnits[bestUnitIndex].route) {
            const r = topUnits[bestUnitIndex].route;
            const durMin = Math.round(r.duration / 60);
            const distKm = (r.distance / 1000).toFixed(1);
            bestContainer.innerHTML = `<span class="eta-badge-best">⭐ Mais rápido: ~${durMin} min (${distKm} km)</span>`;
        }
    }

    // Destaque melhor ETA – Hospitais
    if (bestHospIndex >= 0) {
        const bestCard = document.getElementById(`dispatch-hosp-card-${bestHospIndex}`);
        const bestContainer = document.getElementById(`eta-container-hosp-${bestHospIndex}`);
        if (bestCard) bestCard.classList.add('card-best-eta');
        if (bestContainer && topHospitals[bestHospIndex].route) {
            const r = topHospitals[bestHospIndex].route;
            const durMin = Math.round(r.duration / 60);
            const distKm = (r.distance / 1000).toFixed(1);
            bestContainer.innerHTML = `<span class="eta-badge-best">⭐ Mais rápido: ~${durMin} min (${distKm} km)</span>`;
        }
    }
}

// Sem cache – sempre tenta OSRM se online, senão linha reta
async function getRouteDistance(originLat, originLng, destLat, destLng) {
    if (navigator.onLine) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        try {
            const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=false`;
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            const data = await response.json();
            if (data.code === 'Ok' && data.routes?.length > 0) {
                return {
                    distance: data.routes[0].distance,
                    duration: data.routes[0].duration,
                    source: 'online'
                };
            }
        } catch (e) {
            clearTimeout(timeoutId);
        }
    }
    // Fallback linha reta
    const from = turf.point([originLng, originLat]);
    const to = turf.point([destLng, destLat]);
    const straight = turf.distance(from, to, { units: 'kilometers' }) * 1000;
    return { distance: straight, duration: null, source: 'straight' };
}

function drawStraightLine(originPos, lat, lng, name, distance) {
    if (window.distanceLine) { map.removeLayer(window.distanceLine); window.distanceLine = null; }
    if (window.distanceMarker) { map.removeLayer(window.distanceMarker); window.distanceMarker = null; }
    if (window.routingControl) { map.removeControl(window.routingControl); window.routingControl = null; }

    const latlngs = [[originPos.lat, originPos.lng], [lat, lng]];
    window.distanceLine = L.polyline(latlngs, { color: '#e74c3c', weight: 3, dashArray: '6,6' }).addTo(map);
    window.distanceMarker = L.marker([lat, lng]).addTo(map)
        .bindPopup(`<b>${name}</b><br>➡️ Linha reta (offline)<br>Distância: ${distance.toFixed(2)} km`)
        .openPopup();
    map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50] });
}

async function focusOnFeature(lng, lat, name, distance) {
    if (!originMarker) return;
    const originPos = originMarker.getLatLng();

    if (window.distanceLine) { map.removeLayer(window.distanceLine); window.distanceLine = null; }
    if (window.distanceMarker) { map.removeLayer(window.distanceMarker); window.distanceMarker = null; }
    if (window.routingControl) { map.removeControl(window.routingControl); window.routingControl = null; }

    if (navigator.onLine) {
        const tempMarker = L.marker([lat, lng]).addTo(map)
            .bindPopup(`<b>${name}</b><br>🚗 Carregando traçado da rota...`).openPopup();
        try {
            const route = await getRouteDistance(originPos.lat, originPos.lng, lat, lng);
            if (route && route.source !== 'straight') {
                window.routingControl = L.Routing.control({
                    waypoints: [L.latLng(originPos.lat, originPos.lng), L.latLng(lat, lng)],
                    routeWhileDragging: false,
                    showAlternatives: false,
                    addWaypoints: false,
                    fitSelectedRoutes: true,
                    lineOptions: { styles: [{ color: '#e74c3c', weight: 5, opacity: 0.85 }] }
                }).addTo(map);

                window.routingControl.on('routesfound', e => {
                    const r = e.routes[0];
                    const dist = (r.summary.totalDistance / 1000).toFixed(2);
                    const dur = Math.round(r.summary.totalTime / 60);
                    map.removeLayer(tempMarker);
                    window.distanceMarker = L.marker([lat, lng]).addTo(map)
                        .bindPopup(`
                            <div style="font-family:sans-serif;">
                                <b style="color:#c0392b; font-size:13px;">${name}</b><br>
                                <div style="margin-top:4px; font-size:12px;">
                                    <b>Tempo estimado:</b> ~${dur} min<br>
                                    <b>Distância por via:</b> ${dist} km
                                </div>
                            </div>`).openPopup();
                });
                window.routingControl.on('routingerror', () => {
                    map.removeLayer(tempMarker);
                    drawStraightLine(originPos, lat, lng, name, distance);
                });
                return;
            } else {
                map.removeLayer(tempMarker);
                drawStraightLine(originPos, lat, lng, name, distance);
            }
        } catch (e) {
            if (tempMarker) map.removeLayer(tempMarker);
            drawStraightLine(originPos, lat, lng, name, distance);
        }
    } else {
        drawStraightLine(originPos, lat, lng, name, distance);
    }
}

window.setOriginFromFeature = function (lat, lng, name) {
    if (map) {
        setOrigin(lat, lng, name);
        map.setView([lat, lng], 14);
        calculateDistancesToAllFeatures(lat, lng);
        showToast(`Origem definida: ${name}`, 'success');
    }
};

window.routeToFeature = function (lng, lat, name) {
    if (!originMarker) {
        showToast('Defina primeiro um ponto de origem.', 'warning');
        return;
    }
    const originPos = originMarker.getLatLng();
    const distance = turf.distance(
        turf.point([originPos.lng, originPos.lat]),
        turf.point([lng, lat]),
        { units: 'kilometers' }
    );
    focusOnFeature(lng, lat, name, distance);
};

window.copyFeatureCoords = function (lat, lng) {
    const text = `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => showToast(`Coordenadas copiadas: ${text}`, 'info'))
            .catch(() => showToast(`Coordenadas: ${text}`, 'info'));
    } else {
        showToast(`Coordenadas: ${text}`, 'info');
    }
};

window.zoomToCoords = function (lat, lng, zoomLevel = 15) {
    if (map) map.setView([lat, lng], zoomLevel);
};
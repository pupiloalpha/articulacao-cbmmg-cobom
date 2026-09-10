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

    // ------------------------------------------------------------------
    // Ícones offline (SVG data-URL) – funcionam sem internet
    // ------------------------------------------------------------------
    const originIconSvg = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
  <path fill="#c0392b" stroke="#7b241c" stroke-width="1.2" d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.3 21.7 0 14 0z"/>
  <circle cx="14" cy="14" r="6" fill="#fff"/>
  <circle cx="14" cy="14" r="3.2" fill="#c0392b"/>
</svg>`);

    const destIconSvg = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
  <path fill="#2980b9" stroke="#1a5276" stroke-width="1.2" d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.3 21.7 0 14 0z"/>
  <circle cx="14" cy="14" r="6" fill="#fff"/>
  <circle cx="14" cy="14" r="3.2" fill="#2980b9"/>
</svg>`);

    const originIcon = L.icon({
        iconUrl: `data:image/svg+xml,${originIconSvg}`,
        iconSize: [28, 40],
        iconAnchor: [14, 40],
        popupAnchor: [0, -36]
    });

    const destIcon = L.icon({
        iconUrl: `data:image/svg+xml,${destIconSvg}`,
        iconSize: [28, 40],
        iconAnchor: [14, 40],
        popupAnchor: [0, -36]
    });

    // Expõe globalmente para uso em setOrigin / focusOnFeature / drawStraightLine
    window.originIcon = originIcon;
    window.destIcon = destIcon;

    // Fallback para qualquer outro marcador que ainda use o default do Leaflet
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
            L.DomEvent.on(btn, 'click', e => {
                L.DomEvent.stopPropagation(e);
                zoomToAllFeatures();
            });
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
                extractCoordinates(l.feature.geometry).forEach(c => {
                    bounds.extend(c);
                    hasFeatures = true;
                });
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

    originMarker = L.marker([lat, lng], {
        draggable: true,
        icon: window.originIcon
    }).addTo(map);

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

// ============================================================
// Rota Offline Aproximada (Janela Dinâmica) – versão melhorada
// ============================================================

/**
 * Reverse geocode (Nominatim) para descobrir o município de um ponto.
 * Retorna o nome do município ou null.
 */
async function reverseGeocodeCity(lat, lng) {
    if (!navigator.onLine) return null;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1&accept-language=pt`;
        const res = await fetch(url, {
            headers: { 'Accept': 'application/json' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) return null;
        const data = await res.json();
        const addr = data.address || {};
        // Prioridade: city > town > municipality > county (comum em MG)
        const city = addr.city || addr.town || addr.municipality || addr.county || null;
        return city ? String(city).trim() : null;
    } catch (e) {
        console.warn('reverseGeocodeCity falhou:', e);
        return null;
    }
}

/**
 * Garante que as malhas de logradouros dos municípios da origem e do destino
 * estejam no IndexedDB. Só tenta baixar se estiver online.
 * Também reforça o núcleo RMBH.
 */
async function ensureStreetsAroundPoints(originLat, originLng, destLat, destLng) {
    // Sempre tenta o núcleo RMBH (já tem lógica de “já carregado”)
    if (typeof loadRMBHCoreStreets === 'function') {
        try { await loadRMBHCoreStreets(); } catch (_) {}
    }

    if (!navigator.onLine) return; // offline → não há o que baixar

    const municipalities = new Set();

    // Reverse geocode em paralelo
    const [cityOrigin, cityDest] = await Promise.all([
        reverseGeocodeCity(originLat, originLng),
        reverseGeocodeCity(destLat, destLng)
    ]);

    if (cityOrigin) municipalities.add(cityOrigin);
    if (cityDest) municipalities.add(cityDest);

    // Também tenta extrair de possíveis polígonos de articulação já carregados
    try {
        const containing = await checkPolygonContainment(originLat, originLng);
        containing.forEach(p => {
            if (p.featureName && p.featureName.length > 3) {
                // Pode ser nome de município em polígonos de articulação
                municipalities.add(p.featureName);
            }
        });
    } catch (_) {}

    // Baixa cada município encontrado
    for (const mun of municipalities) {
        if (typeof ensureStreetDataForMunicipality === 'function') {
            try {
                await ensureStreetDataForMunicipality(mun);
            } catch (e) {
                console.warn(`Falha ao pré-carregar logradouros de ${mun}:`, e);
            }
        }
    }

    // Invalida índice de ruas para a próxima busca offline
    if (typeof invalidateStreetIndex === 'function') {
        invalidateStreetIndex();
    }
}

/**
 * Coleta segmentos de logradouro que intersectam o bbox.
 * Retorna array de { coords: [[lng,lat], ...], length }
 */
async function collectStreetSegmentsInBbox(bbox) {
    const layers = await DB.getLayers();
    const segments = [];
    const [minLng, minLat, maxLng, maxLat] = bbox;

    for (const layer of layers) {
        if (!layer?.geojson?.features) continue;
        if (!layer.name || !(layer.name.includes('Logradouros') || layer.name.includes('Ruas'))) continue;

        for (const feature of layer.geojson.features) {
            const geom = feature.geometry;
            if (!geom || (geom.type !== 'LineString' && geom.type !== 'MultiLineString')) continue;

            // Bbox rápido da feature
            let fMinLng = Infinity, fMinLat = Infinity, fMaxLng = -Infinity, fMaxLat = -Infinity;
            const processCoords = (c) => {
                const lng = c[0], lat = c[1];
                if (lng < fMinLng) fMinLng = lng;
                if (lat < fMinLat) fMinLat = lat;
                if (lng > fMaxLng) fMaxLng = lng;
                if (lat > fMaxLat) fMaxLat = lat;
            };

            if (geom.type === 'LineString') {
                geom.coordinates.forEach(processCoords);
            } else {
                geom.coordinates.forEach(line => line.forEach(processCoords));
            }

            // Intersecta com o bbox da janela?
            if (fMaxLng < minLng || fMinLng > maxLng || fMaxLat < minLat || fMinLat > maxLat) continue;

            // Extrai as linhas
            const lines = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates;
            for (const line of lines) {
                if (line.length < 2) continue;
                let len = 0;
                for (let i = 1; i < line.length; i++) {
                    len += turf.distance(
                        turf.point(line[i - 1]),
                        turf.point(line[i]),
                        { units: 'meters' }
                    );
                }
                segments.push({ coords: line, length: len });
            }
        }
    }
    return segments;
}

/**
 * Constrói grafo simples a partir dos segmentos.
 * Nós identificados por chave "lng.toFixed(5),lat.toFixed(5)"
 */
function buildStreetGraph(segments, maxEdges = 1500) {
    const nodes = new Map(); // key → {lng, lat, edges: [{to, weight}]}
    let edgeCount = 0;

    const getKey = (lng, lat) => `${lng.toFixed(5)},${lat.toFixed(5)}`;

    const addNode = (lng, lat) => {
        const key = getKey(lng, lat);
        if (!nodes.has(key)) {
            nodes.set(key, { lng, lat, edges: [] });
        }
        return key;
    };

    // 1. Arestas ao longo de cada segmento
    for (const seg of segments) {
        if (edgeCount >= maxEdges) break;
        const coords = seg.coords;
        for (let i = 1; i < coords.length; i++) {
            if (edgeCount >= maxEdges) break;
            const [lng1, lat1] = coords[i - 1];
            const [lng2, lat2] = coords[i];
            const k1 = addNode(lng1, lat1);
            const k2 = addNode(lng2, lat2);
            const w = turf.distance(turf.point([lng1, lat1]), turf.point([lng2, lat2]), { units: 'meters' });
            if (w < 0.5) continue; // ignora pontos quase idênticos
            nodes.get(k1).edges.push({ to: k2, weight: w });
            nodes.get(k2).edges.push({ to: k1, weight: w });
            edgeCount += 2;
        }
    }

    // 2. Conexões entre nós próximos (< 18 m) – une ruas diferentes
    const nodeKeys = Array.from(nodes.keys());
    for (let i = 0; i < nodeKeys.length && edgeCount < maxEdges; i++) {
        const n1 = nodes.get(nodeKeys[i]);
        for (let j = i + 1; j < nodeKeys.length && edgeCount < maxEdges; j++) {
            const n2 = nodes.get(nodeKeys[j]);
            const d = turf.distance(
                turf.point([n1.lng, n1.lat]),
                turf.point([n2.lng, n2.lat]),
                { units: 'meters' }
            );
            if (d > 0.8 && d < 18) {
                n1.edges.push({ to: nodeKeys[j], weight: d });
                n2.edges.push({ to: nodeKeys[i], weight: d });
                edgeCount += 2;
            }
        }
    }

    return { nodes, edgeCount };
}

/**
 * Dijkstra simples (retorna array de [lng, lat] ou null)
 */
function dijkstra(graph, startKey, endKey) {
    const { nodes } = graph;
    if (!nodes.has(startKey) || !nodes.has(endKey)) return null;

    const dist = new Map();
    const prev = new Map();
    const pq = []; // [distance, key]

    for (const key of nodes.keys()) {
        dist.set(key, Infinity);
    }
    dist.set(startKey, 0);
    pq.push([0, startKey]);

    while (pq.length > 0) {
        pq.sort((a, b) => a[0] - b[0]);
        const [d, u] = pq.shift();
        if (d > dist.get(u)) continue;
        if (u === endKey) break;

        for (const { to, weight } of nodes.get(u).edges) {
            const nd = d + weight;
            if (nd < dist.get(to)) {
                dist.set(to, nd);
                prev.set(to, u);
                pq.push([nd, to]);
            }
        }
    }

    if (!prev.has(endKey) && startKey !== endKey) return null;

    // Reconstrói caminho
    const path = [];
    let cur = endKey;
    while (cur) {
        const n = nodes.get(cur);
        path.push([n.lng, n.lat]);
        cur = prev.get(cur);
    }
    path.reverse();
    return path.length >= 2 ? path : null;
}

/**
 * Encontra o nó mais próximo de um ponto
 */
function findNearestNode(graph, lng, lat) {
    let bestKey = null;
    let bestDist = Infinity;
    for (const [key, node] of graph.nodes) {
        const d = turf.distance(
            turf.point([lng, lat]),
            turf.point([node.lng, node.lat]),
            { units: 'meters' }
        );
        if (d < bestDist) {
            bestDist = d;
            bestKey = key;
        }
    }
    return { key: bestKey, dist: bestDist };
}

/**
 * Função principal – Janela Dinâmica (melhorada)
 * Retorna { path: [[lng,lat],...], distanceMeters, attempts } ou null
 */
async function findApproxOfflineRoute(originLat, originLng, destLat, destLng) {
    const startTime = performance.now();
    const TIMEOUT = 2800; // ms (aumentado)
    const MAX_EDGES = 1500;

    // 1. Garante malhas dos municípios envolvidos (só baixa se online)
    try {
        await ensureStreetsAroundPoints(originLat, originLng, destLat, destLng);
    } catch (e) {
        console.warn('ensureStreetsAroundPoints:', e);
    }

    let bufferKm = 0.5; // buffer inicial maior
    const expansions = [0.7, 0.8, 1.0, 1.2]; // expansões mais generosas

    for (let attempt = 0; attempt <= expansions.length; attempt++) {
        if (performance.now() - startTime > TIMEOUT) {
            console.warn('Timeout na rota offline');
            return null;
        }

        // BBOX da linha origem-destino expandido
        const line = turf.lineString([[originLng, originLat], [destLng, destLat]]);
        const buffered = turf.buffer(line, bufferKm, { units: 'kilometers' });
        const bbox = turf.bbox(buffered);

        const segments = await collectStreetSegmentsInBbox(bbox);
        console.log(`Janela ${attempt + 1}: buffer ${bufferKm.toFixed(1)} km → ${segments.length} segmentos`);

        if (segments.length < 2) {
            if (attempt < expansions.length) bufferKm += expansions[attempt];
            continue;
        }

        const graph = buildStreetGraph(segments, MAX_EDGES);
        if (graph.nodes.size < 2) {
            if (attempt < expansions.length) bufferKm += expansions[attempt];
            continue;
        }

        const startSnap = findNearestNode(graph, originLng, originLat);
        const endSnap = findNearestNode(graph, destLng, destLat);

        // Snap máximo aumentado para 180 m
        if (!startSnap.key || !endSnap.key || startSnap.dist > 180 || endSnap.dist > 180) {
            if (attempt < expansions.length) bufferKm += expansions[attempt];
            continue;
        }

        const path = dijkstra(graph, startSnap.key, endSnap.key);
        if (path && path.length >= 2) {
            let dist = 0;
            for (let i = 1; i < path.length; i++) {
                dist += turf.distance(turf.point(path[i - 1]), turf.point(path[i]), { units: 'meters' });
            }
            return {
                path,
                distanceMeters: Math.round(dist),
                attempts: attempt + 1,
                snapOrigin: startSnap.dist,
                snapDest: endSnap.dist
            };
        }

        if (attempt < expansions.length) bufferKm += expansions[attempt];
    }

    return null;
}

/**
 * Desenha a rota offline encontrada
 */
function drawOfflineRoute(originPos, path, name, distanceMeters) {
    if (window.distanceLine) { map.removeLayer(window.distanceLine); window.distanceLine = null; }
    if (window.distanceMarker) { map.removeLayer(window.distanceMarker); window.distanceMarker = null; }
    if (window.routingControl) { map.removeControl(window.routingControl); window.routingControl = null; }

    // Converte path [[lng,lat]] → [[lat,lng]] para Leaflet
    const latlngs = path.map(c => [c[1], c[0]]);
    // Inclui origem e destino reais
    latlngs.unshift([originPos.lat, originPos.lng]);
    latlngs.push([path[path.length - 1][1], path[path.length - 1][0]]);

    window.distanceLine = L.polyline(latlngs, {
        color: '#1a5276',
        weight: 5,
        opacity: 0.9,
        lineJoin: 'round'
    }).addTo(map);

    const distKm = (distanceMeters / 1000).toFixed(2);

    window.distanceMarker = L.marker([latlngs[latlngs.length - 1][0], latlngs[latlngs.length - 1][1]], {
        icon: window.destIcon
    }).addTo(map)
        .bindPopup(`
            <div style="font-family:sans-serif; max-width:280px;">
                <b style="color:#1a5276; font-size:13px;">${name}</b><br>
                <div style="margin-top:6px; font-size:12px; line-height:1.45;">
                    <b>Rota offline aproximada (vias locais)</b><br>
                    Distância: <b>${distKm} km</b><br>
                    <small style="color:#7f8c8d;">
                        Calculada com a malha de logradouros disponível no dispositivo.<br>
                        Pode conter pequenas imprecisões.
                    </small>
                </div>
            </div>
        `).openPopup();

    map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50] });
    showToast(`Rota offline aproximada: ${distKm} km`, 'success', 4000);
}

/**
 * Substitui a função drawStraightLine original
 */
function drawStraightLine(originPos, lat, lng, name, distance) {
    if (window.distanceLine) { map.removeLayer(window.distanceLine); window.distanceLine = null; }
    if (window.distanceMarker) { map.removeLayer(window.distanceMarker); window.distanceMarker = null; }
    if (window.routingControl) { map.removeControl(window.routingControl); window.routingControl = null; }

    const latlngs = [[originPos.lat, originPos.lng], [lat, lng]];
    window.distanceLine = L.polyline(latlngs, {
        color: '#e74c3c',
        weight: 3,
        dashArray: '8,6',
        opacity: 0.9
    }).addTo(map);

    const distText = distance.toFixed(2);

    const popupContent = `
        <div style="font-family:sans-serif; max-width:280px;">
            <b style="color:#c0392b; font-size:13px;">${name}</b><br>
            <div style="margin-top:6px; font-size:12px; line-height:1.45;">
                <b>Rota offline (linha reta)</b><br>
                Distância aproximada: <b>${distText} km</b><br>
                <small style="color:#7f8c8d;">
                    Sem grafo de vias disponível no momento.
                </small>
            </div>
            <button id="btnCalcOfflineRoute" 
                    style="margin-top:10px; width:100%; padding:7px 10px; background:#1a5276; color:white; border:none; border-radius:5px; font-size:12px; font-weight:600; cursor:pointer;">
                🛣️ Calcular rota aproximada pelas vias locais
            </button>
        </div>
    `;

    window.distanceMarker = L.marker([lat, lng], {
        icon: window.destIcon
    }).addTo(map)
        .bindPopup(popupContent).openPopup();

    map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50] });

    // Listener do botão (depois que o popup abre)
    setTimeout(() => {
        const btn = document.getElementById('btnCalcOfflineRoute');
        if (btn) {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.textContent = '⏳ Calculando...';
                showToast('Calculando rota offline pelas vias locais...', 'info', 2500);

                try {
                    const result = await findApproxOfflineRoute(
                        originPos.lat, originPos.lng,
                        lat, lng
                    );

                    if (result && result.path) {
                        drawOfflineRoute(originPos, result.path, name, result.distanceMeters);
                    } else {
                        showToast(
                            'Não foi possível traçar rota pelas vias locais. Verifique se a malha do município está carregada ou tente novamente online.',
                            'warning',
                            5500
                        );
                        btn.disabled = false;
                        btn.textContent = '🛣️ Calcular rota aproximada pelas vias locais';
                    }
                } catch (err) {
                    console.error('Erro na rota offline:', err);
                    showToast('Erro ao calcular rota offline.', 'error');
                    btn.disabled = false;
                    btn.textContent = '🛣️ Calcular rota aproximada pelas vias locais';
                }
            });
        }
    }, 300);

    showToast(`Rota offline: linha reta aproximada (${distText} km).`, 'warning', 4500);
}

async function focusOnFeature(lng, lat, name, distance) {
    if (!originMarker) return;
    const originPos = originMarker.getLatLng();

    if (window.distanceLine) { map.removeLayer(window.distanceLine); window.distanceLine = null; }
    if (window.distanceMarker) { map.removeLayer(window.distanceMarker); window.distanceMarker = null; }
    if (window.routingControl) { map.removeControl(window.routingControl); window.routingControl = null; }

    if (navigator.onLine) {
        const tempMarker = L.marker([lat, lng], {
            icon: window.destIcon
        }).addTo(map)
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

                    window.distanceMarker = L.marker([lat, lng], {
                        icon: window.destIcon
                    }).addTo(map)
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
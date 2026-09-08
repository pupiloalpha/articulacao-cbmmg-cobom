// js/search.js - Busca de endereços (Online/Offline) sem cache de resultados

let cachedStreetIndex = null;
let isIndexingStreets = false;

function invalidateStreetIndex() {
    cachedStreetIndex = null;
}

async function getOrBuildStreetIndex() {
    if (cachedStreetIndex && cachedStreetIndex.length > 0) return cachedStreetIndex;
    if (isIndexingStreets) return [];

    isIndexingStreets = true;
    try {
        const layers = await DB.getLayers();
        const streetMap = new Map();

        for (const layerData of layers) {
            if (!layerData?.geojson?.features) continue;

            for (const feature of layerData.geojson.features) {
                const props = feature.properties;
                const geom = feature.geometry;
                if (!props || !geom) continue;

                const streetInfo = getFeatureStreetInfo(props);
                if (!streetInfo?.fullName) continue;

                const munCode = streetInfo.cdSetor ? streetInfo.cdSetor.slice(0, 7) : '';
                const streetKey = `${normalizeStr(streetInfo.fullName)}__${munCode}`;

                if (!streetMap.has(streetKey)) {
                    streetMap.set(streetKey, {
                        fullName: streetInfo.fullName,
                        streetOnly: streetInfo.streetOnly,
                        tipLog: streetInfo.tipLog,
                        titLog: streetInfo.titLog,
                        munName: streetInfo.munName || 'RMBH',
                        cdSetor: streetInfo.cdSetor,
                        totalRes: 0,
                        totalGeral: 0,
                        segmentsCount: 0,
                        minLat: Infinity,
                        maxLat: -Infinity,
                        minLng: Infinity,
                        maxLng: -Infinity,
                        layerName: layerData.name,
                        normalizedFull: normalizeStr(streetInfo.fullName),
                        normalizedWithMun: normalizeStr(`${streetInfo.fullName} ${streetInfo.munName || ''}`),
                        normalizedStreetOnly: normalizeStr(streetInfo.streetOnly)
                    });
                }

                const entry = streetMap.get(streetKey);
                entry.segmentsCount++;
                entry.totalRes += streetInfo.totalRes;
                entry.totalGeral += streetInfo.totalGeral;

                extractCoordinatesFromGeom(geom, (lng, lat) => {
                    if (lat < entry.minLat) entry.minLat = lat;
                    if (lat > entry.maxLat) entry.maxLat = lat;
                    if (lng < entry.minLng) entry.minLng = lng;
                    if (lng > entry.maxLng) entry.maxLng = lng;
                });
            }
        }

        const indexList = [];
        for (const entry of streetMap.values()) {
            if (entry.minLat !== Infinity && entry.minLng !== Infinity) {
                entry.lat = (entry.minLat + entry.maxLat) / 2;
                entry.lng = (entry.minLng + entry.maxLng) / 2;
                entry.displayAddress = `${entry.fullName} - ${entry.munName}, MG`;
                indexList.push(entry);
            }
        }

        cachedStreetIndex = indexList;
        return cachedStreetIndex;
    } catch (e) {
        console.error('Erro ao construir índice de ruas:', e);
        return [];
    } finally {
        isIndexingStreets = false;
    }
}

function extractCoordinatesFromGeom(geom, callback) {
    if (!geom || !geom.coordinates) return;
    if (geom.type === 'Point') {
        callback(geom.coordinates[0], geom.coordinates[1]);
    } else if (geom.type === 'LineString' || geom.type === 'MultiPoint') {
        geom.coordinates.forEach(c => callback(c[0], c[1]));
    } else if (geom.type === 'MultiLineString' || geom.type === 'Polygon') {
        geom.coordinates.forEach(line => {
            if (Array.isArray(line)) line.forEach(c => callback(c[0], c[1]));
        });
    } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach(poly => {
            if (Array.isArray(poly)) {
                poly.forEach(line => {
                    if (Array.isArray(line)) line.forEach(c => callback(c[0], c[1]));
                });
            }
        });
    }
}

async function searchAddress(query) {
    const resultsDiv = document.getElementById('searchResults');
    if (!resultsDiv) return;

    const rawQuery = String(query).trim();
    if (!rawQuery) {
        resultsDiv.innerHTML = '';
        return;
    }

    resultsDiv.innerHTML = '<div class="search-status-msg">🔍 Pesquisando endereço no banco local...</div>';

    // Lazy load das ruas
    try {
        const existingLayers = await DB.getLayers();
        const hasStreetLayer = existingLayers.some(l =>
            l.name && (l.name.includes('Ruas') || l.name.includes('Logradouros') || l.name.includes('Street'))
        );
        if (!hasStreetLayer) {
            resultsDiv.innerHTML = '<div class="search-status-msg">📥 Carregando base de logradouros (primeira vez)... Isso pode levar alguns segundos.</div>';
            await loadStreetDataFromGitHub();
            invalidateStreetIndex();
        }
    } catch (e) {
        console.warn('Falha ao carregar base de ruas sob demanda:', e);
    }

    const expandedQuery = expandSearchQuery(rawQuery);
    const queryTokens = expandedQuery.split(/\s+/).filter(Boolean);
    if (queryTokens.length === 0) {
        resultsDiv.innerHTML = '<div class="search-status-msg">Digite um termo válido para busca.</div>';
        return;
    }

    const matchedResults = [];
    const seenAddresses = new Set();

    // 1. Índice de ruas offline
    const streetIndex = await getOrBuildStreetIndex();
    for (const street of streetIndex) {
        const matches = queryTokens.every(token =>
            street.normalizedWithMun.includes(token) || street.normalizedStreetOnly.includes(token)
        );
        if (matches) {
            let score = 0;
            const fullNorm = street.normalizedFull;
            if (fullNorm === expandedQuery) score += 100;
            else if (fullNorm.startsWith(expandedQuery)) score += 60;
            else if (street.normalizedStreetOnly.startsWith(expandedQuery)) score += 50;
            else if (fullNorm.includes(expandedQuery)) score += 40;
            else score += 20;
            if (street.totalRes > 0) score += Math.min(15, street.totalRes);

            const resultKey = `${street.fullName}__${street.munName}`;
            if (!seenAddresses.has(resultKey)) {
                seenAddresses.add(resultKey);
                matchedResults.push({
                    title: street.fullName,
                    munBadge: street.munName,
                    address: street.displayAddress,
                    subtitle: street.totalRes > 0
                        ? `${street.segmentsCount} trecho(s) • ~${street.totalRes} domicílios`
                        : `${street.segmentsCount} trecho(s) de via`,
                    lat: street.lat,
                    lng: street.lng,
                    source: 'offline_ruas',
                    score
                });
            }
        }
    }

    // 2. Outras camadas (POIs, unidades etc.)
    try {
        const layers = await DB.getLayers();
        for (const layer of layers) {
            if (!layer?.geojson?.features) continue;
            if (layer.name && (layer.name.includes('Ruas') || layer.name.includes('RMBH') || layer.name.includes('Logradouros'))) continue;

            for (const feature of layer.geojson.features) {
                const name = feature.properties?.name;
                if (!name) continue;
                const normName = normalizeStr(name);
                const matches = queryTokens.every(token => normName.includes(token));
                if (matches) {
                    const coords = getFeatureCoords(feature);
                    if (coords) {
                        const resultKey = `${name}__${layer.name}`;
                        if (!seenAddresses.has(resultKey)) {
                            seenAddresses.add(resultKey);
                            matchedResults.push({
                                title: name,
                                munBadge: layer.name,
                                address: `${name} (${layer.name})`,
                                subtitle: `Feição na camada ${layer.name}`,
                                lat: coords.lat,
                                lng: coords.lng,
                                source: 'offline_layer',
                                score: normName === expandedQuery ? 90 : 30
                            });
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn('Erro ao buscar em camadas extras:', e);
    }

    matchedResults.sort((a, b) => b.score - a.score);
    const topResults = matchedResults.slice(0, 15);

    if (topResults.length > 0) {
        displaySearchResults(topResults);
        return;
    }

    // 3. Fallback online (Nominatim) – sem gravação
    if (navigator.onLine) {
        try {
            resultsDiv.innerHTML = '<div class="search-status-msg">🌐 Buscando no mapa online (OpenStreetMap)...</div>';
            const viewbox = '-52,-15,-40,-24';
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(rawQuery)}&limit=8&countrycodes=BR&viewbox=${viewbox}&bounded=1&accept-language=pt`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.length > 0) {
                const onlineResults = data.map(item => ({
                    title: item.display_name.split(',')[0],
                    munBadge: 'Online (OSM)',
                    address: item.display_name,
                    subtitle: item.display_name,
                    lat: parseFloat(item.lat),
                    lng: parseFloat(item.lon),
                    source: 'online_osm',
                    score: 50
                }));
                displaySearchResults(onlineResults);
            } else {
                resultsDiv.innerHTML = '<div class="search-status-msg">❌ Nenhum endereço encontrado com os termos informados.</div>';
            }
        } catch (error) {
            console.error('Erro na busca online:', error);
            resultsDiv.innerHTML = '<div class="search-status-msg">Erro na busca online. Tente novamente.</div>';
        }
    } else {
        resultsDiv.innerHTML = '<div class="search-status-msg">📴 Modo Offline: Nenhum endereço correspondente na base local.</div>';
    }
}

function displaySearchResults(results) {
    const resultsDiv = document.getElementById('searchResults');
    if (!resultsDiv) return;
    resultsDiv.innerHTML = '';

    results.forEach(result => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.innerHTML = `
            <div class="search-result-header">
                <span class="search-result-title">📍 ${escapeHtml(result.title)}</span>
                ${result.munBadge ? `<span class="search-result-mun-badge">${escapeHtml(result.munBadge)}</span>` : ''}
            </div>
            <div class="search-result-sub">${escapeHtml(result.subtitle || result.address)}</div>
        `;
        item.addEventListener('click', () => {
            setOrigin(result.lat, result.lng, result.address);
            if (map) map.setView([result.lat, result.lng], 16);
            resultsDiv.innerHTML = '';
            calculateDistancesToAllFeatures(result.lat, result.lng);
            showToast(`Origem definida: ${result.title}`, 'success');
        });
        resultsDiv.appendChild(item);
    });
}
// js/search.js - Busca de endereços (Online prioritário / Offline apenas sem conexão)
// Pesquisa Online primeiro quando conectado. Pesquisa offline somente quando navigator.onLine === false.
// Suporte a número + interpolação + interseções robustas.
// NOVO: pré-carregamento de malha de logradouros ao selecionar resultado online.

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

                const streetInfo = getFeatureStreetInfo(props, layerData.name);
                if (!streetInfo?.fullName) continue;

                const munCode = streetInfo.cdSetor ? streetInfo.cdSetor.slice(0, 7) : '';
                const streetKey = `${normalizeStr(streetInfo.fullName)}__${munCode || normalizeStr(streetInfo.munName)}`;

                if (!streetMap.has(streetKey)) {
                    streetMap.set(streetKey, {
                        fullName: streetInfo.fullName,
                        streetOnly: streetInfo.streetOnly,
                        tipLog: streetInfo.tipLog,
                        titLog: streetInfo.titLog,
                        munName: streetInfo.munName || 'MG',
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
                        normalizedStreetOnly: normalizeStr(streetInfo.streetOnly),
                        streetKey
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

/**
 * Detecta padrão de interseção e extrai as duas ruas.
 * Mais permissivo para "com", "x", "esquina", etc.
 */
function detectIntersection(query) {
    const raw = String(query).trim();
    if (!raw) return null;

    const patterns = [
        /\s+esquina\s+(?:com\s+)?(?:a\s+)?/i,
        /\s+esq\.?\s+(?:com\s+)?(?:a\s+)?/i,
        /\s+com\s+a\s+/i,
        /\s+com\s+/i,
        /\s+x\s+/i,
        /\s+×\s+/i,
        /\s+&\s+/i,
        /\s+e\s+a\s+/i
    ];

    for (const re of patterns) {
        const parts = raw.split(re);
        if (parts.length >= 2) {
            const streetA = parts[0].trim();
            let streetB = parts.slice(1).join(' ').trim();
            streetB = streetB.replace(/,?\s*(MG|Minas Gerais).*$/i, '').trim();

            if (streetA.length >= 3 && streetB.length >= 3) {
                return { streetA, streetB, original: raw };
            }
        }
    }
    return null;
}

/**
 * Tenta extrair município conhecido da query (lista IBGE de MG).
 */
function parseAddressQueryWithCity(query) {
    const intersection = detectIntersection(query);
    const base = parseAddressQuery(query);
    let city = null;
    let streetPart = base.streetPart || '';

    const tokens = String(query).split(/[,\-–]/).map(t => t.trim()).filter(Boolean);
    const allMunNames = Object.values(IBGE_MUNICIPALITIES || {});

    for (let i = tokens.length - 1; i >= 0; i--) {
        const candidate = normalizeStr(tokens[i]);
        if (candidate.length < 4) continue;

        const found = allMunNames.find(mun => {
            const n = normalizeStr(mun);
            return n === candidate || n.includes(candidate) || candidate.includes(n);
        });

        if (found) {
            city = found;
            const cityNorm = normalizeStr(found);
            streetPart = streetPart
                .split(/\s+/)
                .filter(t => !cityNorm.includes(t) && !t.includes(cityNorm.split(' ')[0]))
                .join(' ')
                .trim();
            break;
        }
    }

    return {
        ...base,
        streetPart: streetPart || base.streetPart,
        city,
        isIntersection: !!intersection,
        streetA: intersection ? intersection.streetA : null,
        streetB: intersection ? intersection.streetB : null
    };
}

/**
 * Calcula ponto de interseção (ou aproximação segura) entre duas ruas do MESMO município.
 */
async function findIntersectionPoint(streetA, streetB) {
    if (typeof turf === 'undefined') return null;

    const munA = normalizeStr(streetA.munName || '');
    const munB = normalizeStr(streetB.munName || '');
    if (munA && munB && munA !== munB) {
        return null;
    }

    const distCentroids = turf.distance(
        turf.point([streetA.lng, streetA.lat]),
        turf.point([streetB.lng, streetB.lat]),
        { units: 'kilometers' }
    );
    if (distCentroids > 4.0) {
        return null;
    }

    try {
        const featuresA = await getStreetFeaturesByKey(streetA.fullName, streetA.munName);
        const featuresB = await getStreetFeaturesByKey(streetB.fullName, streetB.munName);

        if (!featuresA.length || !featuresB.length) return null;

        // 1. Interseção geométrica real
        for (const fa of featuresA) {
            for (const fb of featuresB) {
                try {
                    const intersects = turf.lineIntersect(fa, fb);
                    if (intersects?.features?.length > 0) {
                        const [lng, lat] = intersects.features[0].geometry.coordinates;
                        return { lat, lng, exact: true };
                    }
                } catch (_) { /* ignora */ }
            }
        }

        // 2. Fallback controlado: ponto médio dos trechos mais próximos (< 60 m)
        let bestDist = Infinity;
        let bestPoint = null;

        for (const fa of featuresA) {
            for (const fb of featuresB) {
                try {
                    const centerB = turf.center(fb);
                    const ptOnA = turf.nearestPointOnLine(fa, centerB);
                    const ptOnB = turf.nearestPointOnLine(fb, ptOnA);
                    const d = turf.distance(ptOnA, ptOnB, { units: 'meters' });

                    if (d < bestDist && d < 60) {
                        bestDist = d;
                        const mid = turf.midpoint(ptOnA, ptOnB);
                        bestPoint = {
                            lat: mid.geometry.coordinates[1],
                            lng: mid.geometry.coordinates[0],
                            exact: false,
                            approxDistMeters: Math.round(d)
                        };
                    }
                } catch (_) { /* ignora */ }
            }
        }

        return bestPoint;
    } catch (e) {
        console.warn('Erro ao calcular interseção offline:', e);
        return null;
    }
}

/**
 * Score de similaridade de nome de rua (quanto maior, melhor).
 */
function streetNameScore(candidate, queryTokens) {
    let score = 0;
    const full = candidate.normalizedFull;
    const only = candidate.normalizedStreetOnly;

    queryTokens.forEach(t => {
        if (full.includes(t)) score += 10;
        if (only.includes(t)) score += 8;
        if (full.startsWith(t) || only.startsWith(t)) score += 5;
    });

    score += Math.min(15, candidate.totalRes || 0);
    return score;
}

/**
 * ============================================================
 * BUSCA ONLINE (prioritária quando conectado)
 * ============================================================
 */
async function searchAddressOnline(rawQuery, parsed) {
    const resultsDiv = document.getElementById('searchResults');
    if (!resultsDiv) return;

    resultsDiv.innerHTML = '<div class="search-status-msg">🌐 Buscando no mapa online (OpenStreetMap)...</div>';

    try {
        let data = [];
        const seenPlaceIds = new Set();

        // Viewbox aproximado de Minas Gerais (left, top, right, bottom)
        const viewbox = '-51.0,-14.0,-39.5,-23.0';

        const hasClearStreet = parsed.streetPart && parsed.streetPart.length >= 4;
        const hasNumber = parsed.hasNumber;
        const isIncomplete = !hasClearStreet || parsed.isIntersection ||
            (parsed.streetPart || '').split(/\s+/).filter(Boolean).length <= 2;

        // ---------- 1. Structured (quando temos rua clara) ----------
        if (hasClearStreet) {
            const streetParam = hasNumber
                ? `${parsed.streetPart} ${parsed.number}`.trim()
                : parsed.streetPart;

            const params = new URLSearchParams({
                format: 'json',
                addressdetails: '1',
                limit: '12',
                countrycodes: 'BR',
                'accept-language': 'pt',
                street: streetParam,
                state: 'Minas Gerais',
                viewbox: viewbox,
                bounded: '0'
            });
            if (parsed.city) params.set('city', parsed.city);

            const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                headers: {
                    'Accept': 'application/json'
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
            const structured = await response.json();

            if (Array.isArray(structured)) {
                structured.forEach(item => {
                    if (item.place_id && !seenPlaceIds.has(item.place_id)) {
                        seenPlaceIds.add(item.place_id);
                        data.push(item);
                    }
                });
            }
        }

        // ---------- 2. Free-form (sempre poderoso para queries incompletas / interseções) ----------
        if (data.length < 4 || isIncomplete || parsed.isIntersection) {
            const freeParams = new URLSearchParams({
                format: 'json',
                addressdetails: '1',
                limit: '12',
                countrycodes: 'BR',
                'accept-language': 'pt',
                q: `${rawQuery}, Minas Gerais, Brazil`,
                viewbox: viewbox,
                bounded: '0'
            });

            const freeUrl = `https://nominatim.openstreetmap.org/search?${freeParams.toString()}`;
            const freeController = new AbortController();
            const freeTimeout = setTimeout(() => freeController.abort(), 8000);
            const freeRes = await fetch(freeUrl, {
                method: 'GET',
                mode: 'cors',
                headers: { 'Accept': 'application/json' },
                signal: freeController.signal
            });
            clearTimeout(freeTimeout);
            if (!freeRes.ok) throw new Error(`Nominatim HTTP ${freeRes.status}`);
            const freeData = await freeRes.json();

            if (Array.isArray(freeData)) {
                freeData.forEach(item => {
                    if (item.place_id && !seenPlaceIds.has(item.place_id)) {
                        seenPlaceIds.add(item.place_id);
                        data.push(item);
                    }
                });
            }
        }

        // ---------- 3. Fallback extra sem city ----------
        if (data.length === 0 && parsed.city && hasClearStreet) {
            const streetParam = hasNumber
                ? `${parsed.streetPart} ${parsed.number}`.trim()
                : parsed.streetPart;

            const params2 = new URLSearchParams({
                format: 'json',
                addressdetails: '1',
                limit: '10',
                countrycodes: 'BR',
                'accept-language': 'pt',
                street: streetParam,
                state: 'Minas Gerais',
                viewbox: viewbox,
                bounded: '0'
            });

            const url2 = `https://nominatim.openstreetmap.org/search?${params2.toString()}`;
            const ctrl2 = new AbortController();
            const t2 = setTimeout(() => ctrl2.abort(), 8000);
            const res2 = await fetch(url2, {
                method: 'GET',
                mode: 'cors',
                headers: { 'Accept': 'application/json' },
                signal: ctrl2.signal
            });
            clearTimeout(t2);
            if (!res2.ok) throw new Error(`Nominatim HTTP ${res2.status}`);
            const data2 = await res2.json();

            if (Array.isArray(data2)) {
                data2.forEach(item => {
                    if (item.place_id && !seenPlaceIds.has(item.place_id)) {
                        seenPlaceIds.add(item.place_id);
                        data.push(item);
                    }
                });
            }
        }

        if (!Array.isArray(data) || data.length === 0) {
            // Não encontrou online → permite fallback offline
            resultsDiv.innerHTML = '<div class="search-status-msg">🌐 Nada encontrado online. Verificando base local...</div>';
            return false;
        }

        // Scoring e mapeamento
        const onlineResults = data.map(item => {
            let score = 55;
            const addr = item.address || {};
            const house = addr.house_number || '';

            if (parsed.hasNumber && house) {
                const num = parseInt(house, 10);
                if (!isNaN(num) && Math.abs(num - parsed.number) <= 20) score += 45;
                else if (house.includes(String(parsed.number))) score += 30;
            }

            if (addr.state && normalizeStr(addr.state).includes('minas')) score += 15;
            if (parsed.city && (addr.city || addr.town || addr.municipality)) {
                const cityNorm = normalizeStr(parsed.city);
                const foundCity = normalizeStr(addr.city || addr.town || addr.municipality || '');
                if (foundCity.includes(cityNorm) || cityNorm.includes(foundCity)) {
                    score += 25;
                }
            }
            if (parsed.isIntersection) score += 12;

            // Bônus se o display_name contém partes da query original
            const displayNorm = normalizeStr(item.display_name || '');
            const queryTokens = (parsed.streetPart || expandSearchQuery(rawQuery))
                .split(/\s+/)
                .filter(t => t.length >= 3);
            queryTokens.forEach(t => {
                if (displayNorm.includes(t)) score += 4;
            });

            return {
                title: item.display_name.split(',')[0],
                munBadge: addr.city || addr.town || addr.municipality || 'Online (OSM)',
                address: item.display_name,
                subtitle: item.display_name,
                lat: parseFloat(item.lat),
                lng: parseFloat(item.lon),
                source: 'online_osm',
                score,
                houseNumber: house,
                isIntersection: parsed.isIntersection
            };
        });

        onlineResults.sort((a, b) => b.score - a.score);
        displaySearchResults(onlineResults.slice(0, 12));

    } catch (error) {
        console.error('Erro na busca online:', error);
        // Retorna false para o caller fazer fallback offline
        resultsDiv.innerHTML = '<div class="search-status-msg">⚠️ Busca online indisponível (CORS/rede). Tentando base local...</div>';
        return false;
    }
    return true;
}

/**
 * ============================================================
 * BUSCA OFFLINE (somente quando não há conexão)
 * ============================================================
 */
async function searchAddressOffline(rawQuery, parsed) {
    const resultsDiv = document.getElementById('searchResults');
    if (!resultsDiv) return;

    resultsDiv.innerHTML = '<div class="search-status-msg">🔍 Pesquisando endereço no banco local...</div>';

    // Carregamento progressivo de logradouros (apenas offline)
    try {
        resultsDiv.innerHTML = '<div class="search-status-msg">📥 Verificando base de logradouros...</div>';
        await loadStreetDataFromGitHub(rawQuery);
        invalidateStreetIndex();
    } catch (e) {
        console.warn('Falha ao carregar base de ruas sob demanda:', e);
    }

    const searchTokens = (parsed.streetPart || expandSearchQuery(rawQuery))
        .split(/\s+/)
        .filter(Boolean);

    if (searchTokens.length === 0 && !parsed.isIntersection) {
        resultsDiv.innerHTML = '<div class="search-status-msg">Digite um termo válido para busca.</div>';
        return;
    }

    const matchedResults = [];
    const seenAddresses = new Set();

    // ============================================================
    // 0. Caminho especial para INTERSEÇÃO offline
    // ============================================================
    if (parsed.isIntersection && parsed.streetA && parsed.streetB) {
        resultsDiv.innerHTML = '<div class="search-status-msg">🔀 Calculando interseção offline...</div>';

        const streetIndex = await getOrBuildStreetIndex();
        const tokensA = expandSearchQuery(parsed.streetA).split(/\s+/).filter(t => t.length >= 2);
        const tokensB = expandSearchQuery(parsed.streetB).split(/\s+/).filter(t => t.length >= 2);

        const candidatesA = [];
        const candidatesB = [];

        for (const street of streetIndex) {
            const scoreA = streetNameScore(street, tokensA);
            const scoreB = streetNameScore(street, tokensB);

            if (scoreA >= 15) candidatesA.push({ street, score: scoreA });
            if (scoreB >= 15) candidatesB.push({ street, score: scoreB });
        }

        candidatesA.sort((a, b) => b.score - a.score);
        candidatesB.sort((a, b) => b.score - a.score);

        const topA = candidatesA.slice(0, 8);
        const topB = candidatesB.slice(0, 8);

        let found = false;

        for (const ca of topA) {
            if (found) break;
            for (const cb of topB) {
                if (ca.street.streetKey === cb.street.streetKey) continue;

                const munA = normalizeStr(ca.street.munName || '');
                const munB = normalizeStr(cb.street.munName || '');

                if (munA && munB && munA !== munB) continue;

                const point = await findIntersectionPoint(ca.street, cb.street);
                if (point) {
                    const title = `Esquina: ${ca.street.fullName} × ${cb.street.fullName}`;
                    const resultKey = `inter_${ca.street.streetKey}_${cb.street.streetKey}`;
                    if (!seenAddresses.has(resultKey)) {
                        seenAddresses.add(resultKey);
                        matchedResults.push({
                            title,
                            munBadge: ca.street.munName || cb.street.munName,
                            address: `${title} - ${ca.street.munName || cb.street.munName}, MG`,
                            subtitle: point.exact
                                ? 'Interseção geométrica encontrada'
                                : `Aproximação (~${point.approxDistMeters} m entre vias)`,
                            lat: point.lat,
                            lng: point.lng,
                            source: 'offline_intersection',
                            score: point.exact ? 130 : 100,
                            usedInterpolation: true,
                            isIntersection: true
                        });
                        found = true;
                        break;
                    }
                }
            }
        }

        if (matchedResults.length > 0) {
            matchedResults.sort((a, b) => b.score - a.score);
            displaySearchResults(matchedResults.slice(0, 6));
            return;
        }
        // Se não achou interseção, continua o fluxo normal offline
    }

    // ============================================================
    // 1. Índice de ruas offline (busca normal)
    // ============================================================
    const streetIndex = await getOrBuildStreetIndex();

    for (const street of streetIndex) {
        const matches = searchTokens.every(token =>
            street.normalizedWithMun.includes(token) ||
            street.normalizedStreetOnly.includes(token) ||
            street.normalizedFull.includes(token)
        );

        if (!matches) continue;

        let score = 0;
        const fullNorm = street.normalizedFull;
        const queryNorm = parsed.streetPart || expandSearchQuery(rawQuery);

        if (fullNorm === queryNorm) score += 100;
        else if (fullNorm.startsWith(queryNorm)) score += 60;
        else if (street.normalizedStreetOnly.startsWith(queryNorm)) score += 50;
        else if (fullNorm.includes(queryNorm)) score += 40;
        else score += 20;

        if (street.totalRes > 0) score += Math.min(15, street.totalRes);
        if (parsed.hasNumber) score += 5;

        if (parsed.city && normalizeStr(street.munName).includes(normalizeStr(parsed.city))) {
            score += 25;
        }

        const resultKey = `${street.fullName}__${street.munName}`;
        if (seenAddresses.has(resultKey)) continue;
        seenAddresses.add(resultKey);

        let finalLat = street.lat;
        let finalLng = street.lng;
        let subtitle = street.totalRes > 0
            ? `${street.segmentsCount} trecho(s) • ~${street.totalRes} domicílios`
            : `${street.segmentsCount} trecho(s) de via`;
        let usedInterpolation = false;
        let interpolationFailed = false;

        if (parsed.hasNumber) {
            try {
                const features = await getStreetFeaturesByKey(street.fullName, street.munName);
                const point = interpolatePointOnStreet(features, parsed.number, street.totalRes);

                if (point) {
                    finalLat = point.lat;
                    finalLng = point.lng;
                    usedInterpolation = true;
                    subtitle = `Nº ${parsed.number} (posição aproximada) • ${subtitle}`;
                } else {
                    interpolationFailed = true;
                    subtitle = `Nº ${parsed.number} fora da faixa estimada → centro da via • ${subtitle}`;
                }
            } catch (err) {
                console.warn('Erro na interpolação:', err);
                interpolationFailed = true;
            }
        }

        matchedResults.push({
            title: parsed.hasNumber
                ? `${street.fullName}, ${parsed.number}`
                : street.fullName,
            munBadge: street.munName,
            address: parsed.hasNumber
                ? `${street.fullName}, ${parsed.number} - ${street.munName}, MG`
                : street.displayAddress,
            subtitle,
            lat: finalLat,
            lng: finalLng,
            source: 'offline_ruas',
            score,
            usedInterpolation,
            interpolationFailed,
            originalNumber: parsed.number
        });
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
                const matches = searchTokens.every(token => normName.includes(token));
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
                                score: normName === (parsed.streetPart || '') ? 90 : 30
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
    } else {
        resultsDiv.innerHTML = '<div class="search-status-msg">📴 Modo Offline: Nenhum endereço correspondente na base local.</div>';
    }
}

/**
 * Função principal de entrada da busca.
 * Decide automaticamente entre online (prioritário) e offline.
 */
async function searchAddress(query) {
    const resultsDiv = document.getElementById('searchResults');
    if (!resultsDiv) return;

    const rawQuery = String(query).trim();
    if (!rawQuery) {
        resultsDiv.innerHTML = '';
        return;
    }

    // Evita disparar busca online com termos muito curtos (reduz spam no Nominatim)
    if (rawQuery.length < 3) {
        resultsDiv.innerHTML = '<div class="search-status-msg">Digite pelo menos 3 caracteres...</div>';
        return;
    }

    const parsed = parseAddressQueryWithCity(rawQuery);

    if (navigator.onLine) {
        // ===== ONLINE PRIORITÁRIO, com fallback automático para offline =====
        try {
            const onlineOk = await searchAddressOnline(rawQuery, parsed);
            // searchAddressOnline retorna false quando falhou (CORS/rede/vazio)
            if (onlineOk === false) {
                console.warn('Busca online indisponível (CORS/rede). Alternando para base local...');
                await searchAddressOffline(rawQuery, parsed);
            }
        } catch (err) {
            console.warn('Falha na busca online, usando offline:', err);
            await searchAddressOffline(rawQuery, parsed);
        }
    } else {
        // ===== OFFLINE SOMENTE =====
        await searchAddressOffline(rawQuery, parsed);
    }
}

/**
 * Exibe resultados e, no clique de resultado ONLINE, pré-carrega a malha do município.
 */
function displaySearchResults(results) {
    const resultsDiv = document.getElementById('searchResults');
    if (!resultsDiv) return;
    resultsDiv.innerHTML = '';

    results.forEach(result => {
        const item = document.createElement('div');
        item.className = 'search-result-item';

        let extraBadge = '';
        if (result.isIntersection) {
            extraBadge = `<span class="search-result-mun-badge" style="background:#fef3c7;color:#92400e;">🔀 Esquina</span>`;
        } else if (result.usedInterpolation || result.interpolationFailed) {
            extraBadge = `<span class="search-result-mun-badge" style="background:#e8f4f8;color:#1a5276;">Busca realizada offline. Posição aproximada.</span>`;
        } else if (result.source === 'online_osm' && result.houseNumber) {
            extraBadge = `<span class="search-result-mun-badge" style="background:#d5f5e3;color:#1e8449;">Nº ${escapeHtml(result.houseNumber)}</span>`;
        }

        item.innerHTML = `
            <div class="search-result-header">
                <span class="search-result-title">📍 ${escapeHtml(result.title)}</span>
                ${result.munBadge ? `<span class="search-result-mun-badge">${escapeHtml(result.munBadge)}</span>` : ''}
                ${extraBadge}
            </div>
            <div class="search-result-sub">${escapeHtml(result.subtitle || result.address)}</div>
        `;

        item.addEventListener('click', () => {
            setOrigin(result.lat, result.lng, result.address);
            if (map) map.setView([result.lat, result.lng], 16);
            resultsDiv.innerHTML = '';
            calculateDistancesToAllFeatures(result.lat, result.lng);

            // ===== NOVO: pré-carregamento de malha quando o resultado é online =====
            if (result.source === 'online_osm' && navigator.onLine) {
                // Extrai município do badge ou do endereço
                let munToLoad = null;
                if (result.munBadge && result.munBadge !== 'Online (OSM)') {
                    munToLoad = result.munBadge;
                } else if (result.address) {
                    // Tenta extrair do display_name (ex.: "... Belo Horizonte, Minas Gerais, Brasil")
                    const parts = result.address.split(',').map(p => p.trim());
                    // Procura o município conhecido na lista IBGE
                    const allMuns = Object.values(IBGE_MUNICIPALITIES || {});
                    for (const part of parts) {
                        const found = allMuns.find(m => normalizeStr(m) === normalizeStr(part));
                        if (found) {
                            munToLoad = found;
                            break;
                        }
                    }
                }

                if (munToLoad && typeof ensureStreetDataForMunicipality === 'function') {
                    // Background – não bloqueia a UI
                    ensureStreetDataForMunicipality(munToLoad)
                        .then(ok => {
                            if (ok) {
                                console.log(`Malha de logradouros pré-carregada: ${munToLoad}`);
                                if (typeof invalidateStreetIndex === 'function') invalidateStreetIndex();
                            }
                        })
                        .catch(e => console.warn('Pré-carregamento de malha falhou:', e));
                } else if (typeof loadStreetDataFromGitHub === 'function') {
                    // Fallback: usa a query original / título
                    loadStreetDataFromGitHub(result.title || result.address)
                        .catch(e => console.warn('Pré-carregamento via query falhou:', e));
                }
            }

            if (result.isIntersection) {
                showToast('Esquina definida (posição aproximada offline).', 'info', 4000);
            } else if (result.usedInterpolation || result.interpolationFailed) {
                showToast('Busca realizada offline. Posição aproximada.', 'info', 4000);
            } else if (result.source === 'online_osm') {
                showToast(`Origem definida (online): ${result.title}`, 'success');
            } else {
                showToast(`Origem definida: ${result.title}`, 'success');
            }
        });

        resultsDiv.appendChild(item);
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
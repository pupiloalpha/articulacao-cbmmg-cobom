// js/search.js - Algoritmo de busca de endereços (online/offline) com normalização e desduplicação

// Pesquisa de Endereços (Online/Offline)
async function searchAddress(query) {
    const resultsDiv = document.getElementById('searchResults');
    if (!resultsDiv) return;
    resultsDiv.innerHTML = 'Buscando...';

    const normalizedQuery = normalizeStr(query);
    if (!normalizedQuery) {
        resultsDiv.innerHTML = 'Digite um endereço válido.';
        return;
    }

    // Expande abreviações comuns e divide em palavras chave
    const expandedQuery = normalizedQuery
        .replace(/\bav\b\.?/g, 'avenida')
        .replace(/\br\b\.?/g, 'rua')
        .replace(/\bpc\b\.?/g, 'praca')
        .replace(/\btrv\b\.?/g, 'travessa')
        .replace(/\bal\b\.?/g, 'alameda')
        .replace(/\bdr\b\.?/g, 'doutor');
    const queryTokens = expandedQuery.split(/\s+/).filter(Boolean);

    const matchedResults = [];

    // 1. Busca offline na tabela de endereços cacheados anteriormente
    const offlineCached = await DB.searchAddresses(query);
    offlineCached.forEach(addr => {
        matchedResults.push({
            query: addr.query,
            lat: addr.lat,
            lng: addr.lng,
            address: addr.address
        });
    });

    // 2. Busca em TODAS as camadas salvas no banco IndexedDB (GeoJSON de ruas e pontos)
    const layers = await DB.getLayers();
    const uniqueStreets = new Map(); // Para desduplicar por nome normalizado

    for (const layerData of layers) {
        if (!layerData || !layerData.geojson || !Array.isArray(layerData.geojson.features)) continue;

        for (const feature of layerData.geojson.features) {
            const props = feature.properties;
            if (!props) continue;

            const fullName = getFeatureStreetName(props);
            if (!fullName) continue;

            const normalizedFullName = normalizeStr(fullName);
            const normalizedNmLog = normalizeStr(props.NM_LOG || '');
            const normalizedNmLogradouro = normalizeStr(props.NM_LOGRADOURO || props.logradouro || '');

            // Helper para checar se todos os tokens da busca estão presentes na propriedade
            const matchesTokens = (targetStr) => {
                if (!targetStr) return false;
                return queryTokens.every(token => targetStr.includes(token));
            };

            const matches = matchesTokens(normalizedFullName) ||
                            matchesTokens(normalizedNmLog) ||
                            matchesTokens(normalizedNmLogradouro);

            if (matches) {
                const streetKey = normalizedFullName;
                if (uniqueStreets.has(streetKey)) continue;

                // Extrai coordenadas representativas da feição
                let coords = null;
                if (feature.geometry.type === 'LineString') {
                    const midIndex = Math.floor(feature.geometry.coordinates.length / 2);
                    coords = feature.geometry.coordinates[midIndex] || feature.geometry.coordinates[0];
                } else if (feature.geometry.type === 'MultiLineString') {
                    const firstLine = feature.geometry.coordinates[0];
                    if (firstLine) {
                        const midIndex = Math.floor(firstLine.length / 2);
                        coords = firstLine[midIndex] || firstLine[0];
                    }
                } else if (feature.geometry.type === 'Point') {
                    coords = feature.geometry.coordinates;
                }

                if (coords && coords.length >= 2) {
                    uniqueStreets.set(streetKey, {
                        query: query,
                        lat: coords[1],
                        lng: coords[0],
                        address: fullName
                    });
                }
            }
        }
    }

    uniqueStreets.forEach(item => matchedResults.push(item));

    if (matchedResults.length > 0) {
        displaySearchResults(matchedResults);
        return;
    }

    // 3. Se estiver online e não achou nada offline, busca na Nominatim
    if (navigator.onLine) {
        try {
            // Define uma bounding box para Minas Gerais e estados vizinhos
            // Coordenadas aproximadas: minLon=-52, maxLat=-15, maxLon=-40, minLat=-24
            const viewbox = '-52,-15,-40,-24'; // lon_min, lat_max, lon_max, lat_min
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=BR&viewbox=${viewbox}&bounded=1&accept-language=pt`;
            const response = await fetch(url);
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
                resultsDiv.innerHTML = 'Nenhum resultado encontrado na região.';
            }
        } catch (error) {
            console.error('Erro na busca online:', error);
            resultsDiv.innerHTML = 'Erro na busca online. Tente novamente.';
        }
    } else {
        resultsDiv.innerHTML = 'Sem conexão e nenhum resultado offline.';
    }
}

// Exibe a lista de resultados da busca no painel lateral
function displaySearchResults(results) {
    const resultsDiv = document.getElementById('searchResults');
    if (!resultsDiv) return;
    resultsDiv.innerHTML = '';
    
    results.forEach((result) => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.style.padding = '8px';
        div.style.borderBottom = '1px solid #eee';
        div.style.cursor = 'pointer';
        div.textContent = result.address;

        div.addEventListener('click', () => {
            setOrigin(result.lat, result.lng, result.address);
            if (map) map.setView([result.lat, result.lng], 15);
            resultsDiv.innerHTML = '';
            calculateDistancesToAllFeatures(result.lat, result.lng);
        });

        resultsDiv.appendChild(div);
    });
}
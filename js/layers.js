// js/layers.js - Carregamento, renderização e controle de visualização de camadas GeoJSON

// Semeia dados iniciais (backup padrão)
async function seedInitialData() {
    const layers = await DB.getLayers();
    if (layers.length > 0) return;

    try {
        const response = await fetch('./data/backup_inicial.json');
        if (!response.ok) return;
        const backup = await response.json();
        const features = backup.featureCollection.features;

        const points = features.filter(f => f.geometry.type === 'Point');
        const polygons = features.filter(f => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');

        if (points.length) {
            await DB.saveLayer({
                name: 'Unidades CBMMG',
                type: 'geojson',
                geojson: { type: 'FeatureCollection', features: points }
            });
        }

        if (polygons.length) {
            await DB.saveLayer({
                name: 'Articulação CBMMG',
                type: 'geojson',
                geojson: { type: 'FeatureCollection', features: polygons }
            });
        }
        await reloadLayers();
    } catch (e) {
        console.warn('Erro ao carregar dados iniciais de backup:', e);
    }
}

// Carrega os dados das ruas na primeira execução
async function loadStreetDataFromGitHub() {
    try {
        const existingLayers = await DB.getLayers();
        const hasStreetLayer = existingLayers.some(l => l.name && (l.name.includes('Ruas') || l.name.includes('Logradouros')));
        if (hasStreetLayer) {
            console.log('Dados de ruas já carregados.');
            return;
        }

        let files = null;
        let base = './';
        try {
            const indexResponse = await fetch(base + 'data/ruas/index.json');
            if (indexResponse.ok) {
                files = await indexResponse.json();
            }
        } catch (e) {
            console.warn('Índice local de ruas não encontrado, tentando fallback...', e);
        }

        if (!files) {
            const baseUrl = 'https://raw.githubusercontent.com/seu-usuario/gis-pwa-offline/main/';
            const indexResponse = await fetch(baseUrl + 'data/ruas/index.json');
            if (!indexResponse.ok) throw new Error('Falha ao baixar índice de ruas.');
            files = await indexResponse.json();
            base = baseUrl;
        }

        for (const fileInfo of files) {
            const targetUrl = fileInfo.url.startsWith('http') ? fileInfo.url : (base + fileInfo.url);
            const geojsonResponse = await fetch(targetUrl);
            if (!geojsonResponse.ok) {
                console.warn(`Falha ao carregar ${fileInfo.url}`);
                continue;
            }
            const geojson = await geojsonResponse.json();

            await DB.saveLayer({
                name: fileInfo.name,
                type: 'geojson',
                geojson: geojson
            });
            console.log(`Camada "${fileInfo.name}" importada com sucesso no IndexedDB.`);
        }

        await reloadLayers();
        console.log('Dados das ruas carregados com sucesso!');

    } catch (error) {
        console.error('Erro ao carregar dados das ruas:', error);
    }
}

// Recarrega todas as camadas do banco e adiciona ao mapa
async function reloadLayers() {
    Object.values(overlayLayers).forEach(layer => {
        if (map && map.hasLayer(layer)) map.removeLayer(layer);
    });
    overlayLayers = {};
    
    const layers = await DB.getLayers();
    for (const layerData of layers) {
        if (layerVisibility[layerData.id] === undefined) {
            layerVisibility[layerData.id] = true;
        }
        if (layerVisibility[layerData.id]) {
            addLayerToMap(layerData, viewMode);
        }
    }
    updateLayerListUI();
}

// Adiciona uma camada ao mapa a partir dos dados, com filtro opcional
function addLayerToMap(layerData, mode = viewMode) {
    if (!layerData.geojson || !map) return;

    const geojsonLayer = L.geoJSON(layerData.geojson, {
        filter: function(feature) {
            if (mode === 'none') return false;
            if (mode === 'points') {
                return feature.geometry.type === 'Point';
            }
            return true;
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

    const hasPoints = layerData.geojson.features.some(f => f.geometry.type === 'Point');
    if (hasPoints) {
        geojsonLayer.bringToFront();
    }
}

// Atualiza a lista de camadas na interface (UI) - oculta camadas de ruas
function updateLayerListUI() {
    const ul = document.getElementById('layersUl');
    if (!ul) return;

    DB.getLayers().then(layers => {
        ul.innerHTML = '';
        layers.forEach(layer => {
            // Filtra camadas que não devem aparecer na lista (ex: ruas)
            const hiddenNames = ['RMBH', 'Ruas', 'Logradouros', 'Street'];
            const shouldHide = hiddenNames.some(keyword => layer.name.includes(keyword));
            if (shouldHide) return;

            const li = document.createElement('li');
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = layer.name;
            
            const actionsDiv = document.createElement('div');
            
            // Botão de visibilidade
            const visBtn = document.createElement('button');
            visBtn.className = 'btn-icon';
            visBtn.style.fontSize = '1rem';
            visBtn.style.marginRight = '5px';
            const isVisible = layerVisibility[layer.id] !== false;
            visBtn.innerHTML = isVisible ? '👁️' : '👁️‍🗨️';
            visBtn.title = isVisible ? 'Ocultar camada' : 'Exibir camada';
            
            visBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                layerVisibility[layer.id] = !isVisible;
                reloadLayers();
            });
            
            actionsDiv.appendChild(visBtn);

            // Botão de excluir (visível no modo Admin)
            if (isAdmin) {
                const delBtn = document.createElement('button');
                delBtn.className = 'btn-icon';
                delBtn.style.fontSize = '1rem';
                delBtn.innerHTML = '🗑️';
                delBtn.title = 'Excluir camada';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`Deseja excluir a camada "${layer.name}"?`)) {
                        DB.deleteLayer(layer.id).then(() => reloadLayers());
                    }
                });
                actionsDiv.appendChild(delBtn);
            }
            
            li.appendChild(nameSpan);
            li.appendChild(actionsDiv);
            ul.appendChild(li);
        });
    });
}

// Define o modo de visualização ('all' | 'points' | 'none')
function setViewMode(mode) {
    viewMode = mode;
    reloadLayers();
}

// Sincroniza os checkboxes com o estado atual
function syncViewCheckboxes(mode) {
    document.querySelectorAll('.view-checkbox').forEach(cb => {
        cb.checked = (cb.dataset.mode === mode);
    });
}

// Manipula o clique em uma feição do mapa
function handleFeatureClick(e, feature, layer) {
    // Se o modo de seleção de origem estiver ativo, usa o clique para definir a origem
    if (mapClickMode) {
        mapClickMode = false;
        document.getElementById('mapOriginBtn').textContent = '🎯 Definir origem no mapa';
        map.getContainer().style.cursor = '';
        const latlng = e.latlng;
        setOrigin(latlng.lat, latlng.lng, 'Origem manual (clique na feição)');
        map.setView([latlng.lat, latlng.lng], 15);
        calculateDistancesToAllFeatures(latlng.lat, latlng.lng);
        return;
    }

    // Se não há origem, define o ponto clicado como origem (apenas para pontos)
    if (!originMarker && feature.geometry.type === 'Point') {
        const coords = feature.geometry.coordinates;
        setOrigin(coords[1], coords[0], feature.properties?.name || 'Ponto selecionado');
        map.setView([coords[1], coords[0]], 15);
        calculateDistancesToAllFeatures(coords[1], coords[0]);
        return;
    }

    // Se já existe origem, tenta desenhar rota/linha para a feição
    if (originMarker) {
        drawRouteOrLine(feature);
    } else {
        showToast('Defina uma origem primeiro (busca, GPS ou clique no mapa).', 'warning');
    }
}

// RECUPERADO: Função para desenhar a rota ou linha reta até a feição selecionada
function drawRouteOrLine(feature) {
    if (feature.geometry.type !== 'Point') {
        showToast('Apenas feições do tipo Ponto suportam cálculo de rota no clique.', 'info');
        return;
    }
    
    const coords = feature.geometry.coordinates;
    const destLng = coords[0];
    const destLat = coords[1];
    const name = feature.properties?.name || 'Destino selecionado';
    
    const originPos = originMarker.getLatLng();
    const from = turf.point([originPos.lng, originPos.lat]);
    const to = turf.point([destLng, destLat]);
    const distance = turf.distance(from, to, { units: 'kilometers' });
    
    // Chama a função alocada em map.js para gerar visualmente e acionar o OSRM
    focusOnFeature(destLng, destLat, name, distance);
}
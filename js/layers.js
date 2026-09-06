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
            console.log('Dados de ruas já carregados no banco local.');
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
    // Palavras-chave para identificar arquivos de malha viária
    const hiddenNames = ['RMBH', 'Ruas', 'Logradouros', 'Street'];

    for (const layerData of layers) {
        // AÇÃO: Verifica se a camada é uma base de ruas e impede sua renderização visual
        const isStreetLayer = hiddenNames.some(keyword => layerData.name.includes(keyword));
        if (isStreetLayer) {
            continue; // Pula a inserção no mapa, mantendo disponível apenas no banco (IndexedDB) para busca
        }

        if (layerVisibility[layerData.id] === undefined) {
            layerVisibility[layerData.id] = true;
        }
        if (layerVisibility[layerData.id]) {
            addLayerToMap(layerData, viewMode);
        }
    }
    if (typeof invalidateStreetIndex === 'function') {
        invalidateStreetIndex();
    }
    updateLayerListUI();
}

// Identifica a classificação da feição para estilização e exibição correta
function getFeatureClassification(feature) {
    const geomType = feature.geometry?.type;
    const props = feature.properties || {};

    if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
        return 'POLYGON';
    }

    if (props['FRAÇÃO'] || props['Tempo-resposta'] || props['Zona de Quente'] || props['Unidades de Saúde'] || props['Unidade CBMMG']) {
        return 'MUNICIPIO';
    }

    return 'UNIDADE_BM';
}

// Gera badge com cor correspondente ao tempo-resposta
function getTempoRespostaBadge(tempo) {
    if (!tempo || tempo === '-') {
        return '<span class="feature-badge badge-tempo-neutro">Não informado</span>';
    }
    const t = tempo.toLowerCase();
    if (t.includes('< 30') || t.includes('30 min') || t.includes('30min')) {
        return `<span class="feature-badge badge-tempo-verde">⏱️ ${tempo}</span>`;
    }
    if (t.includes('< 1 hora') || t.includes('< 1h') || t.includes('<1h')) {
        return `<span class="feature-badge badge-tempo-amarelo">⏱️ ${tempo}</span>`;
    }
    if (t.includes('> 1 hora') || t.includes('> 1h') || t.includes('>1h')) {
        return `<span class="feature-badge badge-tempo-vermelho">⏱️ ${tempo}</span>`;
    }
    return `<span class="feature-badge badge-tempo-neutro">⏱️ ${tempo}</span>`;
}

// Extrai latitude e longitude representativas da feição
function getFeatureCoords(feature) {
    if (!feature.geometry) return null;
    if (feature.geometry.type === 'Point') {
        return { lng: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1] };
    }
    try {
        if (typeof turf !== 'undefined' && turf.center) {
            const c = turf.center(feature);
            return { lng: c.geometry.coordinates[0], lat: c.geometry.coordinates[1] };
        }
    } catch (e) {
        console.warn('Erro ao obter centroide da feição:', e);
    }
    return null;
}

// Formata o conteúdo HTML para o tooltip flutuante no hover (passar o mouse)
function formatFeatureTooltip(feature) {
    const props = feature.properties || {};
    const type = getFeatureClassification(feature);
    const coords = getFeatureCoords(feature);

    if (type === 'MUNICIPIO') {
        const munName = props.name || 'Município';
        const fracao = props['FRAÇÃO'] || '-';
        const tempo = props['Tempo-resposta'] || '-';
        const zona = props['Zona de Quente'] || '-';
        const ueop = props.UEOP || '-';
        const cob = props.COB || '-';
        const unBm = props['Unidade CBMMG'] || '-';
        const unSaude = props['Unidades de Saúde'] || '-';

        return `
            <div class="feature-card-header header-municipio">
                <h4 class="feature-card-title">🏙️ ${munName}</h4>
                <span class="feature-type-tag">Município</span>
            </div>
            <div class="feature-card-body">
                <div class="feature-info-grid">
                    <div class="feature-info-row">
                        <span class="feature-info-label">Fração Atendimento:</span>
                        <span class="feature-info-value" style="color:#c0392b;">${fracao}</span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Tempo-Resposta:</span>
                        <span class="feature-info-value">${getTempoRespostaBadge(tempo)}</span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Zona de Risco:</span>
                        <span class="feature-info-value"><span class="feature-badge badge-zona">${zona}</span></span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Batalhão / UEOP:</span>
                        <span class="feature-info-value"><span class="feature-badge badge-ueop">${ueop}</span></span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Comando (COB):</span>
                        <span class="feature-info-value"><span class="feature-badge badge-cob">${cob}</span></span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Recursos Locais:</span>
                        <span class="feature-info-value">🚒 ${unBm} BM | 🏥 ${unSaude} Saúde</span>
                    </div>
                </div>
            </div>
        `;
    }

    if (type === 'UNIDADE_BM') {
        const unitName = props.name || 'Unidade Operacional';
        const ueop = props.UEOP || '-';
        const cob = props.COB || '-';
        const coordsStr = coords ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : '-';

        return `
            <div class="feature-card-header header-unidade">
                <h4 class="feature-card-title">🚒 ${unitName}</h4>
                <span class="feature-type-tag">Fração BM</span>
            </div>
            <div class="feature-card-body">
                <div class="feature-info-grid">
                    <div class="feature-info-row">
                        <span class="feature-info-label">Batalhão / UEOP:</span>
                        <span class="feature-info-value"><span class="feature-badge badge-ueop">${ueop}</span></span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Comando (COB):</span>
                        <span class="feature-info-value"><span class="feature-badge badge-cob">${cob}</span></span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Coordenadas:</span>
                        <span class="feature-info-value" style="font-size:11px; font-family:monospace;">${coordsStr}</span>
                    </div>
                </div>
            </div>
        `;
    }

    if (type === 'POLYGON') {
        const polyName = props.name || 'Circunscrição Territorial';
        const mun = props.NM_MUN || props.Field3 || '-';
        const codMun = props.CD_MUN ? `(IBGE ${props.CD_MUN})` : '';
        const area = props.AREA_KM2 ? `${Number(props.AREA_KM2).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km²` : '-';
        const tipoFracao = props.Field8 ? `${props.Field8} - ${props.Field10 || ''}` : (props.Field10 || '-');
        const comando = props.Field7 || '-';
        const status = props.Field5 ? `${props.Field5} ${props.Field11 ? '(' + props.Field11 + ')' : ''}` : (props.Field11 || '-');

        return `
            <div class="feature-card-header header-polygon">
                <h4 class="feature-card-title">🗺️ ${polyName}</h4>
                <span class="feature-type-tag">Área Territorial</span>
            </div>
            <div class="feature-card-body">
                <div class="feature-info-grid">
                    <div class="feature-info-row">
                        <span class="feature-info-label">Município Base:</span>
                        <span class="feature-info-value">${mun} ${codMun}</span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Área de Cobertura:</span>
                        <span class="feature-info-value" style="color:#2980b9;">${area}</span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Tipo da Fração:</span>
                        <span class="feature-info-value">${tipoFracao}</span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Comando / Unidade:</span>
                        <span class="feature-info-value"><span class="feature-badge badge-ueop">${comando}</span></span>
                    </div>
                    <div class="feature-info-row">
                        <span class="feature-info-label">Situação:</span>
                        <span class="feature-info-value">${status}</span>
                    </div>
                </div>
            </div>
        `;
    }

    // Fallback genérico para feições desconhecidas
    return `
        <div class="feature-card-header">
            <h4 class="feature-card-title">📍 ${props.name || 'Feição'}</h4>
        </div>
        <div class="feature-card-body">
            <p>${props.description || 'Sem descrição adicional.'}</p>
        </div>
    `;
}

// Formata o conteúdo HTML para o popup ao clicar (inclui botões de ação operacional e edição)
function formatFeaturePopup(feature) {
    const tooltipHtml = formatFeatureTooltip(feature);
    const coords = getFeatureCoords(feature);
    const props = feature.properties || {};
    const name = (props.name || 'Feição').replace(/'/g, "\\'");

    if (!coords) {
        return tooltipHtml;
    }

    const layerDbId = feature._layerDbId !== undefined ? feature._layerDbId : 'null';
    const featureIdx = feature._featureIndex !== undefined ? feature._featureIndex : 'null';

    const editBtnHtml = (layerDbId !== 'null' && featureIdx !== 'null') ? `
        <button class="btn-popup-action btn-popup-edit" onclick="window.openEditFeatureModal(${layerDbId}, ${featureIdx})">
            ✏️ Editar Dados
        </button>
    ` : '';

    const actionsHtml = `
        <div class="feature-popup-actions">
            <button class="btn-popup-action btn-popup-origin" onclick="window.setOriginFromFeature(${coords.lat}, ${coords.lng}, '${name}')">
                🎯 Definir Origem
            </button>
            <button class="btn-popup-action btn-popup-route" onclick="window.routeToFeature(${coords.lng}, ${coords.lat}, '${name}')">
                🚗 Rota até Aqui
            </button>
            <button class="btn-popup-action btn-popup-copy" onclick="window.copyFeatureCoords(${coords.lat}, ${coords.lng})">
                📋 Copiar Coord.
            </button>
            ${editBtnHtml}
        </div>
    `;

    return `<div class="feature-popup-content-inner">${tooltipHtml}${actionsHtml}</div>`;
}

// Adiciona uma camada ao mapa a partir dos dados, com filtro opcional e interações ricas
function addLayerToMap(layerData, mode = viewMode) {
    if (!layerData.geojson || !map) return;

    // Indexa as feições com o ID da camada e o índice para permitir edição precisa
    if (Array.isArray(layerData.geojson.features)) {
        layerData.geojson.features.forEach((feat, idx) => {
            feat._layerDbId = layerData.id;
            feat._featureIndex = idx;
        });
    }

    const geojsonLayer = L.geoJSON(layerData.geojson, {
        filter: function(feature) {
            const classification = getFeatureClassification(feature);
            // Remove a visualização dos pontos de municípios
            if (classification === 'MUNICIPIO') {
                return false;
            }

            if (mode === 'none') return false;
            if (mode === 'points') {
                return feature.geometry.type === 'Point';
            }
            return true;
        },
        style: function(feature) {
            if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
                const props = feature.properties || {};
                return {
                    fillColor: props.fill || '#0288d1',
                    fillOpacity: props['fill-opacity'] !== undefined ? Number(props['fill-opacity']) : 0.3,
                    color: props.stroke || '#0288d1',
                    weight: props['stroke-width'] !== undefined ? Number(props['stroke-width']) : 1.5,
                    opacity: props['stroke-opacity'] !== undefined ? Number(props['stroke-opacity']) : 1
                };
            }
        },
        pointToLayer: (feature, latlng) => {
            return L.circleMarker(latlng, {
                radius: 8,
                fillColor: '#e74c3c',
                color: '#962d22',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.9
            });
        },
        onEachFeature: (feature, layer) => {
            // Associa Tooltip interativo no hover (segue o cursor do mouse)
            layer.bindTooltip(formatFeatureTooltip(feature), {
                sticky: true,
                className: 'feature-tooltip',
                direction: 'auto',
                opacity: 0.98
            });

            // Associa Popup com ações operacionais no clique
            layer.bindPopup(formatFeaturePopup(feature), {
                className: 'feature-popup',
                maxWidth: 340
            });

            // Destaque visual ao passar o mouse e restauração garantida ao sair
            layer.on('mouseover', function(e) {
                const l = e.target;
                if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
                    l.setStyle({
                        weight: 3,
                        color: '#f39c12',
                        fillColor: '#f39c12',
                        fillOpacity: 0.45
                    });
                } else if (feature.geometry.type === 'Point') {
                    l.setStyle({
                        radius: 11,
                        weight: 3,
                        color: '#f39c12',
                        fillColor: '#e74c3c',
                        fillOpacity: 1
                    });
                }
            });

            layer.on('mouseout', function(e) {
                geojsonLayer.resetStyle(e.target);
            });

            // Tratamento de clique para o modo de marcação manual de origem
            layer.on('click', (e) => {
                if (mapClickMode) {
                    L.DomEvent.stopPropagation(e);
                    handleFeatureClick(e, feature, layer);
                }
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

// Atualiza a lista de camadas na interface (UI)
function updateLayerListUI() {
    const ul = document.getElementById('layersUl');
    if (!ul) return;

    DB.getLayers().then(layers => {
        ul.innerHTML = '';
        layers.forEach(layer => {
            const hiddenNames = ['RMBH', 'Ruas', 'Logradouros', 'Street'];
            const shouldHide = hiddenNames.some(keyword => layer.name.includes(keyword));
            if (shouldHide) return;

            const li = document.createElement('li');
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = layer.name;
            
            const actionsDiv = document.createElement('div');
            
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

function setViewMode(mode) {
    viewMode = mode;
    reloadLayers();
}

function syncViewCheckboxes(mode) {
    document.querySelectorAll('.view-checkbox').forEach(cb => {
        cb.checked = (cb.dataset.mode === mode);
    });
}

function handleFeatureClick(e, feature, layer) {
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

    if (!originMarker && feature.geometry.type === 'Point') {
        const coords = feature.geometry.coordinates;
        setOrigin(coords[1], coords[0], feature.properties?.name || 'Ponto selecionado');
        map.setView([coords[1], coords[0]], 15);
        calculateDistancesToAllFeatures(coords[1], coords[0]);
        return;
    }

    if (originMarker) {
        drawRouteOrLine(feature);
    } else {
        showToast('Defina uma origem primeiro (busca, GPS ou clique no mapa).', 'warning');
    }
}

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
    
    focusOnFeature(destLng, destLat, name, distance);
}
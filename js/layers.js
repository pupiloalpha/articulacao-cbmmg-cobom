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
            const baseUrl = 'https://raw.githubusercontent.com/pupiloalpha/articulacao-cbmmg-cobom/refs/heads/main/';
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

// Recarrega todas as camadas do banco e adiciona ao mapa (respeitando order)
async function reloadLayers() {
    Object.values(overlayLayers).forEach(layer => {
        if (map && map.hasLayer(layer)) map.removeLayer(layer);
    });
    overlayLayers = {};
    
    const layers = await DB.getLayers(); // já vem ordenado por "order"
    const hiddenNames = ['RMBH', 'Ruas', 'Logradouros', 'Street'];

    for (const layerData of layers) {
        const isStreetLayer = hiddenNames.some(keyword => layerData.name.includes(keyword));
        if (isStreetLayer) {
            continue;
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

// Formata o conteúdo HTML para o tooltip flutuante no hover
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

    return `
        <div class="feature-card-header">
            <h4 class="feature-card-title">📍 ${props.name || 'Feição'}</h4>
        </div>
        <div class="feature-card-body">
            <p>${props.description || 'Sem descrição adicional.'}</p>
        </div>
    `;
}

// Formata o conteúdo HTML para o popup ao clicar
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

    const editBtnHtml = (layerDbId !== 'null' && featureIdx !== 'null' && window.isAdmin) ? `
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

// Adiciona uma camada ao mapa a partir dos dados
function addLayerToMap(layerData, mode = viewMode) {
    if (!layerData.geojson || !map) return;

    if (Array.isArray(layerData.geojson.features)) {
        layerData.geojson.features.forEach((feat, idx) => {
            feat._layerDbId = layerData.id;
            feat._featureIndex = idx;
        });
    }

    const geojsonLayer = L.geoJSON(layerData.geojson, {
        filter: function(feature) {
            const classification = getFeatureClassification(feature);
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
            layer.bindTooltip(formatFeatureTooltip(feature), {
                sticky: true,
                className: 'feature-tooltip',
                direction: 'auto',
                opacity: 0.98
            });

            layer.bindPopup(formatFeaturePopup(feature), {
                className: 'feature-popup',
                maxWidth: 340
            });

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

// ==========================================================================
// UI da lista de camadas + ações: Visibilidade, Renomear, Duplicar, Reordenar, Excluir
// ==========================================================================

async function renameLayer(layerId) {
    const layer = await DB.getLayerById(layerId);
    if (!layer) return;
    const newName = prompt('Novo nome da camada:', layer.name);
    if (newName && newName.trim() && newName.trim() !== layer.name) {
        await DB.updateLayer(layerId, { name: newName.trim() });
        await reloadLayers();
        showToast(`Camada renomeada para "${newName.trim()}"`, 'success');
    }
}

async function duplicateLayer(layerId) {
    const layer = await DB.getLayerById(layerId);
    if (!layer) return;
    const newName = prompt('Nome da cópia:', layer.name + ' (cópia)');
    if (!newName || !newName.trim()) return;

    const geojsonCopy = JSON.parse(JSON.stringify(layer.geojson));
    await DB.saveLayer({
        name: newName.trim(),
        type: layer.type || 'geojson',
        geojson: geojsonCopy
    });
    await reloadLayers();
    showToast(`Camada "${newName.trim()}" criada com sucesso!`, 'success');
}

async function moveLayer(layerId, direction) {
    const layers = await DB.getLayers(); // já ordenado
    const idx = layers.findIndex(l => l.id === layerId);
    if (idx === -1) return;

    let swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= layers.length) {
        showToast(direction === 'up' ? 'Já está no topo.' : 'Já está no final.', 'info');
        return;
    }

    const other = layers[swapIdx];
    // Pula camadas ocultas de ruas se necessário, mas como elas não aparecem na UI, ok
    await DB.swapLayerOrder(layerId, other.id);
    await reloadLayers();
    showToast('Ordem das camadas atualizada.', 'success');
}

function updateLayerListUI() {
    const ul = document.getElementById('layersUl');
    if (!ul) return;

    DB.getLayers().then(layers => {
        ul.innerHTML = '';
        const visibleLayers = layers.filter(layer => {
            const hiddenNames = ['RMBH', 'Ruas', 'Logradouros', 'Street'];
            return !hiddenNames.some(keyword => layer.name.includes(keyword));
        });

        visibleLayers.forEach((layer, index) => {
            const li = document.createElement('li');
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = layer.name;
            nameSpan.style.flex = '1';
            nameSpan.style.overflow = 'hidden';
            nameSpan.style.textOverflow = 'ellipsis';
            nameSpan.style.whiteSpace = 'nowrap';
            
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'layer-actions';
            actionsDiv.style.display = 'flex';
            actionsDiv.style.gap = '2px';
            actionsDiv.style.alignItems = 'center';
            
            // Visibilidade
            const visBtn = document.createElement('button');
            visBtn.className = 'btn-icon layer-btn';
            visBtn.style.fontSize = '0.95rem';
            const isVisible = layerVisibility[layer.id] !== false;
            visBtn.innerHTML = isVisible ? '👁️' : '👁️‍🗨️';
            visBtn.title = isVisible ? 'Ocultar camada' : 'Exibir camada';
            visBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                layerVisibility[layer.id] = !isVisible;
                reloadLayers();
            });
            actionsDiv.appendChild(visBtn);

            if (window.isAdmin) {
                // Renomear
                const renameBtn = document.createElement('button');
                renameBtn.className = 'btn-icon layer-btn';
                renameBtn.innerHTML = '✏️';
                renameBtn.title = 'Renomear camada';
                renameBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    renameLayer(layer.id);
                });
                actionsDiv.appendChild(renameBtn);

                // Duplicar
                const dupBtn = document.createElement('button');
                dupBtn.className = 'btn-icon layer-btn';
                dupBtn.innerHTML = '📋';
                dupBtn.title = 'Duplicar camada';
                dupBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    duplicateLayer(layer.id);
                });
                actionsDiv.appendChild(dupBtn);

                // Mover para cima
                const upBtn = document.createElement('button');
                upBtn.className = 'btn-icon layer-btn';
                upBtn.innerHTML = '↑';
                upBtn.title = 'Mover para cima (aumenta prioridade de desenho)';
                upBtn.disabled = index === 0;
                upBtn.style.opacity = index === 0 ? '0.35' : '1';
                upBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    moveLayer(layer.id, 'up');
                });
                actionsDiv.appendChild(upBtn);

                // Mover para baixo
                const downBtn = document.createElement('button');
                downBtn.className = 'btn-icon layer-btn';
                downBtn.innerHTML = '↓';
                downBtn.title = 'Mover para baixo';
                downBtn.disabled = index === visibleLayers.length - 1;
                downBtn.style.opacity = index === visibleLayers.length - 1 ? '0.35' : '1';
                downBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    moveLayer(layer.id, 'down');
                });
                actionsDiv.appendChild(downBtn);

                // Excluir
                const delBtn = document.createElement('button');
                delBtn.className = 'btn-icon layer-btn';
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
        L.DomEvent.stopPropagation(e);

        // Restaura as feições automaticamente
        if (typeof window.exitMapOriginMode === 'function') {
            window.exitMapOriginMode(true);
        } else {
            mapClickMode = false;
            const btn = document.getElementById('mapOriginBtn');
            if (btn) btn.textContent = '🎯 Ponto no mapa';
            if (map) map.getContainer().style.cursor = '';
        }

        const latlng = e.latlng;
        setOrigin(latlng.lat, latlng.lng, 'Origem manual (clique na feição)');
        map.setView([latlng.lat, latlng.lng], 15);
        calculateDistancesToAllFeatures(latlng.lat, latlng.lng);
        showToast('Origem definida.', 'success');
        return;
    }

    // ... resto da função permanece igual ...
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
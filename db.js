// db.js - Gerenciamento do IndexedDB usando Dexie.js

// Inicializa o banco de dados
const db = new Dexie('GisPwaDB');

// Define o schema
db.version(1).stores({
    // Tabela para camadas geográficas (GeoJSON)
    layers: '++id, name, type, created, updated',
    // Tabela para endereços/pontos de busca offline
    addresses: '++id, query, lat, lng, address, timestamp',
    // Tabela para cache de tiles (armazenados como Blob)
    tiles: 'key, blob, timestamp',
    // Tabela de rotas (cache de distâncias)
    routes: '[originLat+originLng+destLat+destLng], distance, duration, timestamp'
});

// Funções para Camadas
async function saveLayer(layerData) {
    layerData.created = new Date();
    layerData.updated = new Date();
    return await db.layers.add(layerData);
}

async function getLayers() {
    return await db.layers.toArray();
}

async function getLayerById(id) {
    return await db.layers.get(id);
}

async function updateLayer(id, changes) {
    changes.updated = new Date();
    return await db.layers.update(id, changes);
}

async function deleteLayer(id) {
    return await db.layers.delete(id);
}

// Funções para Endereços (busca offline)
async function addAddress(addressRecord) {
    addressRecord.timestamp = new Date();
    return await db.addresses.add(addressRecord);
}

async function searchAddresses(query) {
    // Busca simples por substring no campo query ou address
    const all = await db.addresses.toArray();
    const lowerQuery = query.toLowerCase();
    return all.filter(addr => 
        addr.query.toLowerCase().includes(lowerQuery) || 
        addr.address.toLowerCase().includes(lowerQuery)
    );
}

// Funções para Tiles (cache offline)
async function getTile(key) {
    const record = await db.tiles.get(key);
    if (record && record.blob) {
        return record.blob;
    }
    return null;
}

async function saveTile(key, blob) {
    const record = { key, blob, timestamp: new Date() };
    await db.tiles.put(record); // usa put para atualizar se existir
}

async function clearTiles() {
    await db.tiles.clear();
}

// Funções para rotas (cache)
async function getRouteFromCache(originLat, originLng, destLat, destLng) {
    const key = `${originLat}_${originLng}_${destLat}_${destLng}`;
    return await db.routes.get({ originLat, originLng, destLat, destLng });
}

async function saveRouteToCache(originLat, originLng, destLat, destLng, distance, duration) {
    const record = {
        originLat,
        originLng,
        destLat,
        destLng,
        distance, // em metros
        duration, // em segundos
        timestamp: new Date()
    };
    await db.routes.put(record);
}

async function clearRoutesCache() {
    await db.routes.clear();
}

// Exportação e Importação de Backup
async function exportBackup() {
    const layers = await db.layers.toArray();
    const addresses = await db.addresses.toArray();
    
    // Combina todas as features em um FeatureCollection para backup
    const allFeatures = [];
    layers.forEach(layer => {
        const geojson = layer.geojson;
        if (geojson && geojson.features) {
            geojson.features.forEach(feature => {
                feature.properties = feature.properties || {};
                feature.properties._layerId = layer.id;
                feature.properties._layerName = layer.name;
                allFeatures.push(feature);
            });
        }
    });
    
    const backup = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        featureCollection: {
            type: 'FeatureCollection',
            features: allFeatures
        },
        addresses: addresses
    };
    
    return JSON.stringify(backup, null, 2);
}

async function importBackup(jsonString) {
    try {
        const backup = JSON.parse(jsonString);
        // Limpa o banco atual
        await db.layers.clear();
        await db.addresses.clear();
        
        // Restaura endereços
        if (backup.addresses && Array.isArray(backup.addresses)) {
            for (const addr of backup.addresses) {
                await addAddress(addr);
            }
        }
        
        // Restaura camadas a partir do FeatureCollection
        if (backup.featureCollection && backup.featureCollection.features) {
            // Agrupa features por _layerName ou _layerId
            const grouped = {};
            backup.featureCollection.features.forEach(feature => {
                const layerName = feature.properties?._layerName || 'Backup Layer';
                if (!grouped[layerName]) {
                    grouped[layerName] = {
                        type: 'FeatureCollection',
                        features: []
                    };
                }
                // Remove propriedades internas
                const cleanFeature = { ...feature };
                if (cleanFeature.properties) {
                    delete cleanFeature.properties._layerId;
                    delete cleanFeature.properties._layerName;
                }
                grouped[layerName].features.push(cleanFeature);
            });
            
            // Salva cada grupo como uma camada
            for (const [name, geojson] of Object.entries(grouped)) {
                await saveLayer({
                    name: name,
                    type: 'geojson',
                    geojson: geojson
                });
            }
        }
        return true;
    } catch (e) {
        console.error('Erro ao importar backup:', e);
        return false;
    }
}

// Exporta funções globalmente
window.DB = {
    saveLayer,
    getLayers,
    getLayerById,
    updateLayer,
    deleteLayer,
    addAddress,
    searchAddresses,
    getTile,
    saveTile,
    clearTiles,
    exportBackup,
    importBackup,
    getRouteFromCache,
    saveRouteToCache,
    clearRoutesCache
};
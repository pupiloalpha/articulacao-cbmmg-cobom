// db.js - Gerenciamento do IndexedDB usando Dexie.js

// Inicializa o banco de dados
const db = new Dexie('GisPwaDB');

// Schema versão 1 (legado)
db.version(1).stores({
    layers: '++id, name, type, created, updated',
    addresses: '++id, query, lat, lng, address, timestamp',
    tiles: 'key, blob, timestamp',
    routes: '[originLat+originLng+destLat+destLng], distance, duration, timestamp'
});

// Schema versão 2: adiciona campo "order" para reordenação de camadas
db.version(2).stores({
    layers: '++id, name, type, order, created, updated',
    addresses: '++id, query, lat, lng, address, timestamp',
    tiles: 'key, blob, timestamp',
    routes: '[originLat+originLng+destLat+destLng], distance, duration, timestamp'
}).upgrade(tx => {
    // Migração: preenche order para camadas existentes
    return tx.table('layers').toCollection().modify(layer => {
        if (typeof layer.order === 'undefined' || layer.order === null) {
            layer.order = layer.id || Date.now();
        }
    });
});

// Funções para Camadas
async function saveLayer(layerData) {
    layerData.created = new Date();
    layerData.updated = new Date();
    if (typeof layerData.order === 'undefined' || layerData.order === null) {
        const last = await db.layers.orderBy('order').last();
        layerData.order = (last && typeof last.order === 'number') ? last.order + 1 : 1;
    }
    return await db.layers.add(layerData);
}

async function getLayers() {
    // Retorna sempre ordenado por "order" ascendente
    return await db.layers.orderBy('order').toArray();
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

/** Troca a ordem de duas camadas (usado pelas setas ↑↓) */
async function swapLayerOrder(idA, idB) {
    const layerA = await db.layers.get(idA);
    const layerB = await db.layers.get(idB);
    if (!layerA || !layerB) return false;
    const orderA = layerA.order;
    await db.layers.update(idA, { order: layerB.order, updated: new Date() });
    await db.layers.update(idB, { order: orderA, updated: new Date() });
    return true;
}

// Funções para Endereços (busca offline)
async function addAddress(addressRecord) {
    addressRecord.timestamp = new Date();
    return await db.addresses.add(addressRecord);
}

async function searchAddresses(query) {
    const all = await db.addresses.toArray();
    const lowerQuery = query.toLowerCase();
    return all.filter(addr => 
        (addr.query && addr.query.toLowerCase().includes(lowerQuery)) || 
        (addr.address && addr.address.toLowerCase().includes(lowerQuery))
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
    await db.tiles.put(record);
}

async function clearTiles() {
    await db.tiles.clear();
}

// Funções para rotas (cache)
async function getRouteFromCache(originLat, originLng, destLat, destLng) {
    return await db.routes.get({ originLat, originLng, destLat, destLng });
}

async function saveRouteToCache(originLat, originLng, destLat, destLng, distance, duration) {
    const record = {
        originLat,
        originLng,
        destLat,
        destLng,
        distance,
        duration,
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
        version: '1.1',
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
        await db.layers.clear();
        await db.addresses.clear();
        
        if (backup.addresses && Array.isArray(backup.addresses)) {
            for (const addr of backup.addresses) {
                await addAddress(addr);
            }
        }
        
        if (backup.featureCollection && backup.featureCollection.features) {
            const grouped = {};
            backup.featureCollection.features.forEach(feature => {
                const layerName = feature.properties?._layerName || 'Backup Layer';
                if (!grouped[layerName]) {
                    grouped[layerName] = {
                        type: 'FeatureCollection',
                        features: []
                    };
                }
                const cleanFeature = { ...feature };
                if (cleanFeature.properties) {
                    delete cleanFeature.properties._layerId;
                    delete cleanFeature.properties._layerName;
                }
                grouped[layerName].features.push(cleanFeature);
            });
            
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
    swapLayerOrder,
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
// db.js - Gerenciamento do IndexedDB usando Dexie.js (versão limpa - sem addresses/routes)

const db = new Dexie('GisPwaDB');

// Schema versão 3: apenas layers + tiles
db.version(3).stores({
    layers: '++id, name, type, order, created, updated',
    tiles: 'key, blob, timestamp'
}).upgrade(tx => {
    // Migração silenciosa de versões anteriores (remove stores antigas se existirem)
    return Promise.resolve();
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

async function swapLayerOrder(idA, idB) {
    const layerA = await db.layers.get(idA);
    const layerB = await db.layers.get(idB);
    if (!layerA || !layerB) return false;
    const orderA = layerA.order;
    await db.layers.update(idA, { order: layerB.order, updated: new Date() });
    await db.layers.update(idB, { order: orderA, updated: new Date() });
    return true;
}

// Funções para Tiles (cache offline)
async function getTile(key) {
    const record = await db.tiles.get(key);
    return record && record.blob ? record.blob : null;
}

async function saveTile(key, blob) {
    await db.tiles.put({ key, blob, timestamp: new Date() });
}

async function clearTiles() {
    await db.tiles.clear();
}

// Exportação / Importação de Backup (somente layers)
async function exportBackup() {
    const layers = await db.layers.toArray();
    const allFeatures = [];
    layers.forEach(layer => {
        if (layer.geojson && layer.geojson.features) {
            layer.geojson.features.forEach(feature => {
                const f = JSON.parse(JSON.stringify(feature));
                f.properties = f.properties || {};
                f.properties._layerId = layer.id;
                f.properties._layerName = layer.name;
                allFeatures.push(f);
            });
        }
    });
    return JSON.stringify({
        version: '1.2',
        exportedAt: new Date().toISOString(),
        featureCollection: { type: 'FeatureCollection', features: allFeatures }
    }, null, 2);
}

async function importBackup(jsonString) {
    try {
        const backup = JSON.parse(jsonString);
        await db.layers.clear();
        if (backup.featureCollection && backup.featureCollection.features) {
            const grouped = {};
            backup.featureCollection.features.forEach(feature => {
                const layerName = feature.properties?._layerName || 'Backup Layer';
                if (!grouped[layerName]) {
                    grouped[layerName] = { type: 'FeatureCollection', features: [] };
                }
                const clean = { ...feature };
                if (clean.properties) {
                    delete clean.properties._layerId;
                    delete clean.properties._layerName;
                }
                grouped[layerName].features.push(clean);
            });
            for (const [name, geojson] of Object.entries(grouped)) {
                await saveLayer({ name, type: 'geojson', geojson });
            }
        }
        return true;
    } catch (e) {
        console.error('Erro ao importar backup:', e);
        return false;
    }
}

window.DB = {
    saveLayer,
    getLayers,
    getLayerById,
    updateLayer,
    deleteLayer,
    swapLayerOrder,
    getTile,
    saveTile,
    clearTiles,
    exportBackup,
    importBackup
};
// js/tiles.js - Gerenciador do modal e do processo de download de tiles offline

function setupTileDownload() {
    const downloadBtn = document.getElementById('downloadTilesBtn');
    const tileModal = document.getElementById('tileModal');
    const closeTileModal = document.getElementById('closeTileModal');
    const startTileDownload = document.getElementById('startTileDownload');
    const tileProgress = document.getElementById('tileProgress');

    if (!downloadBtn || !tileModal) return;

    downloadBtn.addEventListener('click', () => {
        tileModal.classList.remove('hidden');
        updateTileEstimate();
    });

    closeTileModal.addEventListener('click', () => {
        tileModal.classList.add('hidden');
    });

    const minZoomInput = document.getElementById('minZoom');
    const maxZoomInput = document.getElementById('maxZoom');

    function updateTileEstimate() {
        if (!map) return;
        const minZoom = parseInt(minZoomInput.value, 10) || 10;
        const maxZoom = parseInt(maxZoomInput.value, 10) || 14;
        const bounds = map.getBounds();
        let totalTiles = 0;

        for (let z = minZoom; z <= maxZoom; z++) {
            const { minX, maxX, minY, maxY } = getTileBoundsForZoom(bounds, z);
            totalTiles += (maxX - minX + 1) * (maxY - minY + 1);
        }

        const estMB = (totalTiles * 15 / 1024).toFixed(1);
        tileProgress.innerHTML = `Estimativa: <b>${totalTiles}</b> tiles (~<b>${estMB} MB</b>)`;
    }

    if (minZoomInput) minZoomInput.addEventListener('input', updateTileEstimate);
    if (maxZoomInput) maxZoomInput.addEventListener('input', updateTileEstimate);

    if (startTileDownload) {
        startTileDownload.addEventListener('click', async () => {
            const minZoom = parseInt(minZoomInput.value, 10);
            const maxZoom = parseInt(maxZoomInput.value, 10);
            const bounds = map.getBounds();

            const tilesToFetch = [];

            const subdomains = ['a', 'b', 'c'];
            for (let z = minZoom; z <= maxZoom; z++) {
                const { minX, maxX, minY, maxY } = getTileBoundsForZoom(bounds, z);
                for (let x = minX; x <= maxX; x++) {
                    for (let y = minY; y <= maxY; y++) {
                        const s = subdomains[(x + y) % subdomains.length];
                        const url = `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
                        const key = `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png_${z}_${x}_${y}`;
                        tilesToFetch.push({ url, key });
                    }
                }
            }

            const totalTiles = tilesToFetch.length;
            if (totalTiles === 0) {
                showToast('Nenhum tile selecionado.', 'warning');
                return;
            }

            startTileDownload.disabled = true;
            let completed = 0;
            let saved = 0;
            showToast(`Iniciando download paralelo de ${totalTiles} tiles...`, 'info');

            // Pool concorrente com 6 requisições simultâneas
            const CONCURRENCY = 6;
            let currentIndex = 0;

            async function downloadWorker() {
                while (currentIndex < tilesToFetch.length) {
                    const idx = currentIndex++;
                    const tileItem = tilesToFetch[idx];
                    try {
                        const existing = await DB.getTile(tileItem.key);
                        if (!existing) {
                            const resp = await fetch(tileItem.url);
                            if (resp.ok) {
                                const blob = await resp.blob();
                                await DB.saveTile(tileItem.key, blob);
                                saved++;
                            }
                        }
                    } catch (e) {
                        console.warn('Erro ao baixar tile:', tileItem.url, e);
                    }
                    completed++;
                    if (completed % 4 === 0 || completed === totalTiles) {
                        const pct = Math.round((completed / totalTiles) * 100);
                        tileProgress.innerHTML = `Progresso: <b>${completed}</b> / ${totalTiles} tiles (${pct}%) — <i>${saved} novos</i>`;
                    }
                }
            }

            const workers = Array.from(
                { length: Math.min(CONCURRENCY, tilesToFetch.length) },
                () => downloadWorker()
            );
            await Promise.all(workers);

            startTileDownload.disabled = false;
            tileProgress.innerHTML = `✅ Concluído: <b>${saved}</b> novos tiles salvos (total verificado: ${completed})`;
            showToast('Download de tiles concluído com sucesso!', 'success');
        });
    }
}

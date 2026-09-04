// js/gps.js - Gerenciador de rastreamento contínuo de posição GPS com círculo de precisão

let gpsWatchId = null;
let gpsAccuracyCircle = null;

function setupGpsTracking() {
    const gpsBtn = document.getElementById('useMyLocationBtn');
    if (!gpsBtn) return;

    gpsBtn.addEventListener('click', () => {
        if (!('geolocation' in navigator)) {
            showToast('Geolocalização não é suportada por este navegador.', 'error');
            return;
        }

        // Se já estiver rastreando, desativa
        if (gpsWatchId !== null) {
            navigator.geolocation.clearWatch(gpsWatchId);
            gpsWatchId = null;
            if (gpsAccuracyCircle && map) map.removeLayer(gpsAccuracyCircle);
            gpsAccuracyCircle = null;
            gpsBtn.textContent = '📍 Minha Localização';
            gpsBtn.style.background = '';
            showToast('Rastreamento GPS desativado.', 'info');
            return;
        }

        gpsBtn.textContent = '🔄 Rastreando...';
        gpsBtn.style.background = '#27ae60';
        showToast('Obtendo localização GPS...', 'info');

        gpsWatchId = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude, accuracy } = position.coords;

                // Atualiza origem
                setOrigin(latitude, longitude, `Minha Localização (precisão: ${Math.round(accuracy)}m)`);
                calculateDistancesToAllFeatures(latitude, longitude);

                // Círculo de precisão
                if (gpsAccuracyCircle && map) {
                    gpsAccuracyCircle.setLatLng([latitude, longitude]);
                    gpsAccuracyCircle.setRadius(accuracy);
                } else if (map) {
                    gpsAccuracyCircle = L.circle([latitude, longitude], {
                        radius: accuracy,
                        color: '#2980b9',
                        fillColor: '#3498db',
                        fillOpacity: 0.15,
                        weight: 1
                    }).addTo(map);
                }

                if (map) map.setView([latitude, longitude], 16);
            },
            (error) => {
                console.warn('Erro ao obter GPS:', error);
                showToast(`Falha no GPS: ${error.message}`, 'error');
                gpsBtn.textContent = '📍 Minha Localização';
                gpsBtn.style.background = '';
                if (gpsWatchId !== null) {
                    navigator.geolocation.clearWatch(gpsWatchId);
                    gpsWatchId = null;
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 10000
            }
        );
    });
}

// js/gps.js
// Rastreamento contínuo de posição GPS com círculo de precisão.
//
// Otimizações para dispositivos móveis:
//   • Throttling por distância mínima (20 m), tempo mínimo (3 s) e ganho
//     de precisão (10 m) — descarta ruído de GPS sem perder movimento real.
//   • Briefing operacional pesado (buildOriginBriefing + distâncias a
//     todas as camadas) só roda a cada 30 s OU a cada 150 m percorridos.
//   • Entre briefings, apenas move o marker silenciosamente (sem popup,
//     sem varredura de camadas).
//   • Recentralização via map.panTo (preserva zoom) e suspensa por 8 s
//     após interação manual do usuário com o mapa.

let gpsWatchId = null;
let gpsAccuracyCircle = null;

// ---------------------------------------------------------------------------
// Estado interno de throttling
// ---------------------------------------------------------------------------
let _gpsLastProcessed   = { lat: null, lng: null, ts: 0, accuracy: Infinity };
let _gpsLastBriefingTs  = 0;
let _gpsUserInteractedAt = 0;
let _gpsHasCenteredOnce = false;

// Limiares — ajustáveis sem quebrar comportamento
const GPS_MIN_MOVE_M            = 20;       // ignora ruído < 20 m
const GPS_MIN_INTERVAL_MS       = 3000;     // mínimo 3 s entre processamentos
const GPS_ACCURACY_IMPROVE_M    = 10;       // reprocessa se precisão melhorar
const GPS_BRIEFING_INTERVAL_MS  = 30000;    // briefing pesado no máx 1×/30 s
const GPS_BRIEFING_MOVE_M       = 150;      // ou se mover > 150 m
const GPS_RECENTER_COOLDOWN_MS  = 8000;     // 8 s de pausa após interação

/**
 * Distância haversine em metros — leve, sem dependência de turf.js.
 */
function _haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function setupGpsTracking() {
    const gpsBtn = document.getElementById('useMyLocationBtn');
    if (!gpsBtn) return;

    // Marca interação manual do usuário com o mapa (arrastar / dar zoom).
    // Enquanto estiver "recente", o GPS não recentraliza.
    if (typeof map !== 'undefined' && map) {
        map.on('dragstart zoomstart', () => {
            _gpsUserInteractedAt = Date.now();
        });
    }

    gpsBtn.addEventListener('click', () => {
        if (!('geolocation' in navigator)) {
            showToast('Geolocalização não é suportada por este navegador.', 'error');
            return;
        }

        // Toggle: desativa se já está rastreando
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

        // Reset do estado de throttling a cada nova sessão
        _gpsLastProcessed   = { lat: null, lng: null, ts: 0, accuracy: Infinity };
        _gpsLastBriefingTs  = 0;
        _gpsHasCenteredOnce = false;

        gpsWatchId = navigator.geolocation.watchPosition(
            _onGpsPosition,
            _onGpsError,
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 5000
            }
        );
    });

    function _onGpsError(error) {
        console.warn('Erro ao obter GPS:', error);
        showToast(`Falha no GPS: ${error.message}`, 'error');
        gpsBtn.textContent = '📍 Minha Localização';
        gpsBtn.style.background = '';
        if (gpsWatchId !== null) {
            navigator.geolocation.clearWatch(gpsWatchId);
            gpsWatchId = null;
        }
    }

    function _onGpsPosition(position) {
        const now = Date.now();
        const { latitude, longitude, accuracy } = position.coords;

        // ------------------------------------------------------------------
        // 1. Filtro de throttling — decide se vale processar este fix
        // ------------------------------------------------------------------
        const hasPrev = _gpsLastProcessed.lat !== null;
        const movedM = hasPrev
            ? _haversineM(_gpsLastProcessed.lat, _gpsLastProcessed.lng, latitude, longitude)
            : Infinity;
        const elapsed = now - _gpsLastProcessed.ts;
        const accuracyImproved = accuracy < _gpsLastProcessed.accuracy - GPS_ACCURACY_IMPROVE_M;

        const shouldProcess =
            !hasPrev ||
            movedM >= GPS_MIN_MOVE_M ||
            elapsed >= GPS_MIN_INTERVAL_MS ||
            accuracyImproved;

        if (!shouldProcess) return;

        _gpsLastProcessed = { lat: latitude, lng: longitude, ts: now, accuracy };

        // ------------------------------------------------------------------
        // 2. Círculo de precisão — operação barata, sempre atualiza
        // ------------------------------------------------------------------
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

        // ------------------------------------------------------------------
        // 3. Briefing pesado — só a cada 30 s OU 150 m percorridos
        // ------------------------------------------------------------------
        const briefingElapsed = now - _gpsLastBriefingTs;
        const shouldRunBriefing =
            !hasPrev ||
            briefingElapsed >= GPS_BRIEFING_INTERVAL_MS ||
            movedM >= GPS_BRIEFING_MOVE_M;

        const desc = `Minha Localização (precisão: ${Math.round(accuracy)}m)`;

        if (shouldRunBriefing) {
            _gpsLastBriefingTs = now;
            // Ciclo completo: marker + popup com briefing + painel de despacho
            setOrigin(latitude, longitude, desc);
            calculateDistancesToAllFeatures(latitude, longitude);
        } else {
            // Atualização intermediária silenciosa: só move o marker.
            // Não abre popup, não recalcula distâncias, não varre camadas.
            setOrigin(latitude, longitude, desc, { silent: true });
        }

        // ------------------------------------------------------------------
        // 4. Recentralização inteligente
        //    - Primeira fixação: setView com zoom 16 (comportamento clássico)
        //    - Fixações seguintes: panTo (preserva zoom do usuário)
        //    - Silencia por 8 s se o usuário acabou de mexer no mapa
        // ------------------------------------------------------------------
        if (!map) return;
        const userRecentlyInteracted =
            (now - _gpsUserInteractedAt) < GPS_RECENTER_COOLDOWN_MS;

        if (userRecentlyInteracted) return;

        if (!_gpsHasCenteredOnce) {
            map.setView([latitude, longitude], 16);
            _gpsHasCenteredOnce = true;
        } else {
            // panTo anima suavemente e NÃO reseta o zoom atual
            map.panTo([latitude, longitude], { animate: true, duration: 0.6 });
        }
    }
}

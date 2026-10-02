// js/weather.js — Camadas meteorológicas + Open-Meteo pontual + cache offline do radar
// Ativação sob demanda — zero impacto quando desligadas.

const WEATHER_STORAGE_KEY = 'cobom_owm_api_key';
const WEATHER_OPACITY_KEY = 'cobom_weather_opacity';

// ---------------------------------------------------------------------------
// Definição das camadas meteorológicas
// ---------------------------------------------------------------------------
const WEATHER_LAYERS = {
    precipitation: {
        id: 'weather-precipitation',
        label: 'Precipitação',
        iconKey: 'droplet',
        color: '#2980b9',
        owmLayer: 'precipitation_new',
        opacity: 0.55,
        maxZoom: 18
    },
    clouds: {
        id: 'weather-clouds',
        label: 'Nuvens',
        iconKey: 'cloud',
        color: '#7f8c8d',
        owmLayer: 'clouds_new',
        opacity: 0.45,
        maxZoom: 18
    },
    wind: {
        id: 'weather-wind',
        label: 'Vento',
        iconKey: 'wind',
        color: '#16a085',
        owmLayer: 'wind_new',
        opacity: 0.55,
        maxZoom: 18
    },
    radar: {
        id: 'weather-radar',
        label: 'Radar (chuva)',
        iconKey: 'radar',
        color: '#e67e22',
        isRainViewer: true,
        opacity: 0.6,
        maxZoom: 7
    },
    storm: {
        id: 'weather-storm',
        label: 'Tempestade',
        iconKey: 'zap',
        color: '#c0392b',
        isRainViewer: true,
        colorScheme: 4,         // Universal Blue (destaca células severas)
        opacity: 0.7,
        maxZoom: 7
    }
};

// ---------------------------------------------------------------------------
// Estado interno
// ---------------------------------------------------------------------------
let weatherLayers = {};          // id → L.TileLayer
let weatherActive = {};          // id → boolean
let rainViewerFrames = null;     // cache do JSON do RainViewer
let rainViewerCurrentTs = null;
let _rainViewerHost = null;

// ---------------------------------------------------------------------------
// Open-Meteo — dados pontuais (sem chave de API)
// ---------------------------------------------------------------------------
const _openMeteoCache = new Map();
const OPEN_METEO_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

/**
 * Busca dados meteorológicos atuais via Open-Meteo para uma coordenada.
 * Retorna { temperature, precipitation, weatherCode, windSpeed, windDirection,
 *           rain, showers, snowfall, cape, liftedIndex } ou null.
 *
 * Open-Meteo: gratuito, sem chave, CC BY 4.0.
 * Documentação: https://open-meteo.com/en/docs
 */
async function fetchOpenMeteoWeather(lat, lng) {
    const key = `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
    const cached = _openMeteoCache.get(key);
    if (cached && (Date.now() - cached.ts) < OPEN_METEO_CACHE_TTL_MS) {
        return cached.data;
    }

    const params = (typeof getWeatherNetworkParams === 'function')
        ? getWeatherNetworkParams()
        : { openMeteoTimeout: 4000 };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), params.openMeteoTimeout);

    try {
        const url = `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${lat}&longitude=${lng}` +
            `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,` +
            `wind_speed_10m,wind_direction_10m,wind_gusts_10m,` +
            `cape,lifted_index,` +
            `rain,showers,snowfall` +
            `&hourly=precipitation_probability,precipitation` +
            `&timezone=America/Sao_Paulo` +
            `&forecast_days=1`;

        const res = await fetch(url, {
            method: 'GET',
            mode: 'cors',
            headers: { 'Accept': 'application/json' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const current = data.current || {};
        const hourly = data.hourly || {};

        // Próxima hora com maior probabilidade de chuva
        let maxPrecipProb = 0;
        let maxPrecipHour = null;
        if (Array.isArray(hourly.precipitation_probability)) {
            const now = new Date();
            const currentHour = now.getHours();
            for (let i = 0; i < hourly.precipitation_probability.length; i++) {
                const prob = hourly.precipitation_probability[i];
                if (prob > maxPrecipProb && i >= currentHour) {
                    maxPrecipProb = prob;
                    maxPrecipHour = hourly.time?.[i] || null;
                }
            }
        }

        const result = {
            temperature: current.temperature_2m,
            humidity: current.relative_humidity_2m,
            precipitation: current.precipitation || 0,
            weatherCode: current.weather_code,
            windSpeed: current.wind_speed_10m,
            windDirection: current.wind_direction_10m,
            windGusts: current.wind_gusts_10m,
            cape: current.cape,                    // energia convectiva (tempestade)
            liftedIndex: current.lifted_index,     // instabilidade
            rain: current.rain || 0,
            showers: current.showers || 0,
            snowfall: current.snowfall || 0,
            maxPrecipProb,
            maxPrecipHour,
            updatedAt: Date.now()
        };

        _openMeteoCache.set(key, { data: result, ts: Date.now() });
        // Eviction simples
        if (_openMeteoCache.size > 100) {
            const firstKey = _openMeteoCache.keys().next().value;
            _openMeteoCache.delete(firstKey);
        }

        return result;
    } catch (e) {
        clearTimeout(timeoutId);
        console.warn('[Weather] Open-Meteo falhou:', e.message);
        return null;
    }
}

/**
 * Retorna descrição textual e cor para weather_code (WMO).
 * https://open-meteo.com/en/docs#weathervariables
 */
function describeWeatherCode(code) {
    const map = {
        0: { label: 'Céu limpo', icon: 'sun', color: '#f1c40f' },
        1: { label: 'Poucas nuvens', icon: 'cloud', color: '#f39c12' },
        2: { label: 'Parcialmente nublado', icon: 'cloud', color: '#7f8c8d' },
        3: { label: 'Nublado', icon: 'cloud', color: '#5d6d7e' },
        45: { label: 'Nevoeiro', icon: 'cloud', color: '#95a5a6' },
        48: { label: 'Nevoeiro com geada', icon: 'cloud', color: '#95a5a6' },
        51: { label: 'Garoa leve', icon: 'droplet', color: '#3498db' },
        53: { label: 'Garoa moderada', icon: 'droplet', color: '#2980b9' },
        55: { label: 'Garoa densa', icon: 'droplet', color: '#1f618d' },
        61: { label: 'Chuva leve', icon: 'droplet', color: '#3498db' },
        63: { label: 'Chuva moderada', icon: 'droplet', color: '#2980b9' },
        65: { label: 'Chuva forte', icon: 'droplet', color: '#1a5276' },
        71: { label: 'Neve leve', icon: 'cloud', color: '#d5dbdb' },
        73: { label: 'Neve moderada', icon: 'cloud', color: '#aab7b8' },
        75: { label: 'Neve forte', icon: 'cloud', color: '#7f8c8d' },
        80: { label: 'Pancadas leves', icon: 'droplet', color: '#3498db' },
        81: { label: 'Pancadas moderadas', icon: 'droplet', color: '#2980b9' },
        82: { label: 'Pancadas violentas', icon: 'alert', color: '#c0392b' },
        95: { label: 'Tempestade', icon: 'zap', color: '#e74c3c' },
        96: { label: 'Tempestade com granizo leve', icon: 'zap', color: '#c0392b' },
        99: { label: 'Tempestade com granizo forte', icon: 'zap', color: '#922b21' }
    };
    return map[code] || { label: 'Condição desconhecida', icon: 'cloud', color: '#7f8c8d' };
}

// ---------------------------------------------------------------------------
// OpenWeatherMap (tiles) — mantido como opção
// ---------------------------------------------------------------------------
function getOwmApiKey() {
    return localStorage.getItem(WEATHER_STORAGE_KEY) || '';
}

function setOwmApiKey(key) {
    if (key && typeof key === 'string') {
        localStorage.setItem(WEATHER_STORAGE_KEY, key.trim());
    } else {
        localStorage.removeItem(WEATHER_STORAGE_KEY);
    }
}

function createOwmTileLayer(layerKey) {
    const cfg = WEATHER_LAYERS[layerKey];
    if (!cfg || cfg.isRainViewer) return null;

    const apiKey = getOwmApiKey();
    if (!apiKey) {
        console.warn('[Weather] Chave OpenWeatherMap não configurada.');
        return null;
    }

    const url = `https://tile.openweathermap.org/map/${cfg.owmLayer}/{z}/{x}/{y}.png?appid=${apiKey}`;
    const weatherParams = (typeof getWeatherNetworkParams === 'function')
        ? getWeatherNetworkParams()
        : {};

    return L.tileLayer(url, {
        maxZoom: Math.min(cfg.maxZoom || 18, weatherParams.radarMaxZoom || 18),
        opacity: cfg.opacity,
        attribution: '© <a href="https://openweathermap.org/" target="_blank" rel="noopener">OpenWeatherMap</a>',
        crossOrigin: true,
        updateWhenIdle: true,
        keepBuffer: 2,
        updateWhenZooming: false
    });
}

// ---------------------------------------------------------------------------
// RainViewer — radar com cache offline via IndexedDB
// ---------------------------------------------------------------------------
async function ensureRainViewerFrames() {
    if (rainViewerFrames) return rainViewerFrames;

    try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
            mode: 'cors',
            cache: 'no-store'
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        rainViewerFrames = data;
        _rainViewerHost = data.host || 'https://tilecache.rainviewer.com';

        const radar = data.radar?.past || [];
        if (radar.length > 0) {
            rainViewerCurrentTs = radar[radar.length - 1].path;
        }
        return data;
    } catch (e) {
        console.warn('[Weather] Falha ao obter frames RainViewer:', e);
        return null;
    }
}

/**
 * TileLayer que usa o IndexedDB como cache local para os tiles do RainViewer.
 * Reutiliza a infraestrutura de DB.tiles já existente no PWA.
 */
class CachedRainViewerLayer extends L.TileLayer {
    createTile(coords, done) {
        const tile = document.createElement('img');
        tile.alt = '';
        tile.setAttribute('role', 'presentation');
        const tileUrl = this.getTileUrl(coords);
        const tileKey = `rainviewer_${this._url}_${coords.z}_${coords.x}_${coords.y}`;

        // Tenta cache primeiro
        if (window.DB && typeof DB.getTile === 'function') {
            DB.getTile(tileKey).then(blob => {
                if (blob) {
                    const objectURL = URL.createObjectURL(blob);
                    tile.src = objectURL;
                    tile.onload = () => { URL.revokeObjectURL(objectURL); done(null, tile); };
                    tile.onerror = () => { URL.revokeObjectURL(objectURL); this._fetchFromNetwork(tileUrl, tileKey, tile, done); };
                } else {
                    this._fetchFromNetwork(tileUrl, tileKey, tile, done);
                }
            }).catch(() => this._fetchFromNetwork(tileUrl, tileKey, tile, done));
        } else {
            this._fetchFromNetwork(tileUrl, tileKey, tile, done);
        }
        return tile;
    }

    _fetchFromNetwork(url, key, tile, done) {
        fetch(url).then(r => {
            if (!r.ok) throw new Error('Network error');
            return r.blob();
        }).then(blob => {
            if (window.DB && typeof DB.saveTile === 'function') {
                DB.saveTile(key, blob).catch(() => {});
            }
            const objectURL = URL.createObjectURL(blob);
            tile.src = objectURL;
            tile.onload = () => { URL.revokeObjectURL(objectURL); done(null, tile); };
            tile.onerror = () => { URL.revokeObjectURL(objectURL); done(new Error('Tile load fail'), tile); };
        }).catch(err => done(err, tile));
    }
}

async function createRainViewerLayer(layerKey) {
    const cfg = WEATHER_LAYERS[layerKey];
    if (!cfg || !cfg.isRainViewer) return null;

    const data = await ensureRainViewerFrames();
    if (!data || !rainViewerCurrentTs) return null;

    const host = _rainViewerHost || 'https://tilecache.rainviewer.com';
    const path = rainViewerCurrentTs;
    const colorScheme = cfg.colorScheme || 2;  // 2 = Original, 4 = Universal Blue
    const weatherParams = (typeof getWeatherNetworkParams === 'function')
        ? getWeatherNetworkParams()
        : { radarMaxZoom: 7 };

    const url = `${host}${path}/256/{z}/{x}/{y}/${colorScheme}/1_1.png`;

    return new CachedRainViewerLayer(url, {
        maxZoom: Math.min(cfg.maxZoom || 7, weatherParams.radarMaxZoom || 7),
        opacity: cfg.opacity,
        attribution: 'Radar © <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
        crossOrigin: true,
        updateWhenIdle: true,
        keepBuffer: 2,
        updateWhenZooming: false
    });
}

// ---------------------------------------------------------------------------
// Toggle de camada
// ---------------------------------------------------------------------------
async function toggleWeatherLayer(layerKey, forceState = null) {
    if (!map) return;

    const cfg = WEATHER_LAYERS[layerKey];
    if (!cfg) return;

    const currentlyActive = !!weatherActive[layerKey];
    const shouldActivate = forceState !== null ? forceState : !currentlyActive;

    // Remove se existir
    if (weatherLayers[layerKey] && map.hasLayer(weatherLayers[layerKey])) {
        map.removeLayer(weatherLayers[layerKey]);
    }

    if (!shouldActivate) {
        weatherActive[layerKey] = false;
        updateWeatherUI();
        return;
    }

    let layer = null;

    if (cfg.isRainViewer) {
        layer = await createRainViewerLayer(layerKey);
        if (!layer) {
            showToast(`${cfg.label} indisponível no momento.`, 'warning', 3000);
            return;
        }
    } else {
        if (!getOwmApiKey()) {
            showToast(
                'Configure a chave OpenWeatherMap (localStorage.setItem("cobom_owm_api_key", "SUA_CHAVE")). Conta gratuita em openweathermap.org',
                'warning',
                6000
            );
            return;
        }
        layer = createOwmTileLayer(layerKey);
        if (!layer) return;
    }

    layer.addTo(map);
    weatherLayers[layerKey] = layer;
    weatherActive[layerKey] = true;

    if (layer.setZIndex) layer.setZIndex(350);

    updateWeatherUI();
    showToast(`${cfg.label} ativada.`, 'info', 1800);
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
function updateWeatherUI() {
    // Painel flutuante (fonte primária)
    document.querySelectorAll('.weather-panel-item[data-weather-key]').forEach(item => {
        const key = item.dataset.weatherKey;
        const active = !!weatherActive[key];
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
    });

    // Compat retroativa: botões legados na sidebar (se existirem)
    Object.keys(WEATHER_LAYERS).forEach(key => {
        const btn = document.getElementById(`weather-btn-${key}`);
        if (btn) btn.classList.toggle('active', !!weatherActive[key]);
    });
}

// ---------------------------------------------------------------------------
// Painel flutuante de clima (substitui os chips meteorológicos)
// ---------------------------------------------------------------------------
function openWeatherPanel() {
    const panel = document.getElementById('weatherPanel');
    const btn = document.getElementById('weatherPanelToggle');
    if (!panel) return;
    panel.classList.remove('hidden');
    btn?.classList.add('is-active');
    btn?.setAttribute('aria-expanded', 'true');
}

function closeWeatherPanel() {
    const panel = document.getElementById('weatherPanel');
    const btn = document.getElementById('weatherPanelToggle');
    if (!panel) return;
    panel.classList.add('hidden');
    btn?.classList.remove('is-active');
    btn?.setAttribute('aria-expanded', 'false');
}

function initWeatherPanel() {
    const panel      = document.getElementById('weatherPanel');
    const list       = document.getElementById('weatherPanelList');
    const toggleBtn  = document.getElementById('weatherPanelToggle');
    const closeBtn   = document.getElementById('weatherPanelClose');
    if (!panel || !list || !toggleBtn) return;

    // -----------------------------------------------------------------------
    // Preenche a lista com um item por camada
    // -----------------------------------------------------------------------
    list.innerHTML = Object.entries(WEATHER_LAYERS).map(([key, cfg]) => {
        const source = cfg.isRainViewer ? 'RainViewer' : 'OpenWeatherMap';
        const icon = (typeof svgIcon === 'function')
            ? svgIcon(cfg.iconKey || 'globe', 16)
            : '☁';
        return `
            <button type="button" class="weather-panel-item"
                    data-weather-key="${key}"
                    aria-pressed="false">
                <span class="weather-panel-item-icon"
                      style="--wicon-color: ${cfg.color};"
                      aria-hidden="true">${icon}</span>
                <span class="weather-panel-item-text">
                    <span class="weather-panel-item-label">${cfg.label}</span>
                    <span class="weather-panel-item-hint">${source}</span>
                </span>
                <span class="weather-panel-item-state" aria-hidden="true">
                    <span class="weather-panel-item-dot"></span>
                </span>
            </button>
        `;
    }).join('');

    // -----------------------------------------------------------------------
    // Wire: cliques nos itens do painel
    // -----------------------------------------------------------------------
    list.querySelectorAll('.weather-panel-item').forEach(item => {
        item.addEventListener('click', () => {
            const key = item.dataset.weatherKey;
            toggleWeatherLayer(key);
        });
    });

    // -----------------------------------------------------------------------
    // Wire: toggle do painel
    // -----------------------------------------------------------------------
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !panel.classList.contains('hidden');
        if (isOpen) closeWeatherPanel();
        else        openWeatherPanel();
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeWeatherPanel();
        });
    }

    // -----------------------------------------------------------------------
    // Comportamento de "popover": fecha ao clicar fora / ESC
    // -----------------------------------------------------------------------
    document.addEventListener('click', (e) => {
        if (panel.classList.contains('hidden')) return;
        if (panel.contains(e.target)) return;
        if (toggleBtn.contains(e.target)) return;
        closeWeatherPanel();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !panel.classList.contains('hidden')) {
            closeWeatherPanel();
        }
    });

    // Expor para o console / admin
    window.openWeatherPanel  = openWeatherPanel;
    window.closeWeatherPanel = closeWeatherPanel;
}

/**
 * Compat retroativa: mantida como noop — os chips meteorológicos foram
 * substituídos pelo painel flutuante. Preservada para não quebrar código
 * externo que ainda a referencie.
 */
function initWeatherChips() { /* noop */ }

function renderWeatherControls(container) {
    if (!container) return;

    let html = `
        <div class="weather-controls">
            <h3 style="font-size:0.82rem; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:8px;">
                Camadas meteorológicas
            </h3>
            <div class="weather-btn-grid">
    `;

    Object.entries(WEATHER_LAYERS).forEach(([key, cfg]) => {
        html += `
            <button type="button" id="weather-btn-${key}" class="btn weather-btn"
                    data-weather="${key}" title="${cfg.label}">
                ${typeof svgIcon === 'function' ? svgIcon(cfg.iconKey || 'globe', 14) : ''}
                ${cfg.label}
            </button>
        `;
    });

    html += `
            </div>
            <p class="weather-help" style="font-size:11px; color:var(--text-muted); margin-top:8px; line-height:1.35;">
                Precipitação / Nuvens / Vento exigem chave gratuita OpenWeatherMap.
                Radar e Tempestade (RainViewer) não precisam de chave.
            </p>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', html);

    Object.keys(WEATHER_LAYERS).forEach(key => {
        const btn = document.getElementById(`weather-btn-${key}`);
        if (btn) {
            btn.addEventListener('click', () => toggleWeatherLayer(key));
        }
    });
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
function initWeatherLayers() {
    // Ícones extras
    if (typeof SVG_ICON_PATHS !== 'undefined') {
        if (!SVG_ICON_PATHS.cloud) {
            SVG_ICON_PATHS.cloud = '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>';
        }
        if (!SVG_ICON_PATHS.wind) {
            SVG_ICON_PATHS.wind = '<path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>';
        }
        if (!SVG_ICON_PATHS.radar) {
            SVG_ICON_PATHS.radar = '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>';
        }
    }

    initWeatherPanel();

    // Expor para o console / admin
    window.toggleWeatherLayer = toggleWeatherLayer;
    window.setOwmApiKey = setOwmApiKey;
    window.getOwmApiKey = getOwmApiKey;
    window.fetchOpenMeteoWeather = fetchOpenMeteoWeather;
    window.describeWeatherCode = describeWeatherCode;

    console.log('[Weather] Módulo meteorológico inicializado (desligado por padrão).');
}

// Exporta
window.initWeatherLayers = initWeatherLayers;
window.renderWeatherControls = renderWeatherControls;
window.WEATHER_LAYERS = WEATHER_LAYERS;
window.fetchOpenMeteoWeather = fetchOpenMeteoWeather;
window.describeWeatherCode = describeWeatherCode;
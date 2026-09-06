// Dicionário de Códigos IBGE de Municípios de Minas Gerais (RMBH e Sedes CBMMG)
const IBGE_MUNICIPALITIES = {
    '3156700': 'Sabará',
    '3106200': 'Belo Horizonte',
    '3106705': 'Betim',
    '3118601': 'Contagem',
    '3144805': 'Nova Lima',
    '3157807': 'Santa Luzia',
    '3171204': 'Vespasiano',
    '3129806': 'Ibirité',
    '3154606': 'Ribeirão das Neves',
    '3109006': 'Brumadinho',
    '3114303': 'Caeté',
    '3124104': 'Esmeraldas',
    '3130101': 'Igarapé',
    '3132206': 'Itabirito',
    '3136652': 'Juatuba',
    '3137601': 'Lagoa Santa',
    '3140159': 'Mário Campos',
    '3140704': 'Mateus Leme',
    '3149309': 'Pedro Leopoldo',
    '3153905': 'Raposos',
    '3155306': 'Rio Acima',
    '3157906': 'Santana do Riacho',
    '3158953': 'São Joaquim de Bicas',
    '3159308': 'São José da Lapa',
    '3157609': 'Sarzedo',
    '3159605': 'Sete Lagoas',
    '3100104': 'Abadia dos Dourados',
    '3100203': 'Abaeté',
    '3100302': 'Abre Campo',
    '3100609': 'Água Boa',
    '3100708': 'Água Comprida',
    '3100807': 'Aguanil',
    '3100906': 'Águas Formosas',
    '3101409': 'Albertina',
    '3101508': 'Além Paraíba',
    '3101631': 'Alfredo Vasconcelos',
    '3103207': 'Araçaí',
    '3103504': 'Araguari',
    '3106655': 'Berizal',
    '3107901': 'Bom Repouso',
    '3115359': 'Catas Altas',
    '3122306': 'Divinópolis',
    '3126109': 'Formiga',
    '3120904': 'Curvelo',
    '3105103': 'Bambuí',
    '3104007': 'Araxá',
    '3105608': 'Barbacena',
    '3170206': 'Uberlândia',
    '3170107': 'Uberaba',
    '3143302': 'Montes Claros',
    '3136702': 'Juiz de Fora',
    '3127701': 'Governador Valadares',
    '3131307': 'Ipatinga',
    '3148004': 'Patos de Minas',
    '3151800': 'Poços de Caldas',
    '3152501': 'Pouso Alegre',
    '3168606': 'Teófilo Otoni',
    '3169307': 'Três Corações',
    '3170701': 'Varginha',
    '3139409': 'Manhuaçu',
    '3152105': 'Ponte Nova'
};

// Obtém o nome do município a partir do código IBGE ou código de setor censitário
function getMunicipalityName(cdSetorOrCdMun) {
    if (!cdSetorOrCdMun) return '';
    const codeStr = String(cdSetorOrCdMun).replace(/\D/g, '');
    const prefix7 = codeStr.slice(0, 7);
    const prefix6 = codeStr.slice(0, 6);
    
    if (IBGE_MUNICIPALITIES[prefix7]) return IBGE_MUNICIPALITIES[prefix7];
    if (IBGE_MUNICIPALITIES[prefix6 + '0']) return IBGE_MUNICIPALITIES[prefix6 + '0'];
    
    // Procura por correspondência parcial
    for (const [code, name] of Object.entries(IBGE_MUNICIPALITIES)) {
        if (code.startsWith(prefix6) || prefix7.startsWith(code.slice(0, 6))) {
            return name;
        }
    }
    return '';
}

// Helper para remover acentos, pontuação e converter para minúsculas
function normalizeStr(str) {
    if (!str) return '';
    return String(str)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, " ")
        .replace(/\s+/g, " ")
        .toLowerCase()
        .trim();
}

// Expande abreviações comuns da língua portuguesa para busca precisa
function expandSearchQuery(query) {
    if (!query) return '';
    let q = ' ' + normalizeStr(query) + ' ';

    const replacements = [
        [/\bav\b\.?/g, 'avenida'],
        [/\bavd\b\.?/g, 'avenida'],
        [/\br\b\.?/g, 'rua'],
        [/\bpc\b\.?/g, 'praca'],
        [/\bpca\b\.?/g, 'praca'],
        [/\btrv\b\.?/g, 'travessa'],
        [/\btrav\b\.?/g, 'travessa'],
        [/\bal\b\.?/g, 'alameda'],
        [/\bdr\b\.?/g, 'doutor'],
        [/\bdra\b\.?/g, 'doutora'],
        [/\bpe\b\.?/g, 'padre'],
        [/\bsto\b\.?/g, 'santo'],
        [/\bsta\b\.?/g, 'santa'],
        [/\bns\b\.?/g, 'nossa senhora'],
        [/\bpref\b\.?/g, 'prefeito'],
        [/\bver\b\.?/g, 'vereador'],
        [/\bprof\b\.?/g, 'professor'],
        [/\bprofa\b\.?/g, 'professora'],
        [/\bexp\b\.?/g, 'expedicionario'],
        [/\bcel\b\.?/g, 'coronel'],
        [/\bten\b\.?/g, 'tenente'],
        [/\bcap\b\.?/g, 'capitao'],
        [/\bmaj\b\.?/g, 'major'],
        [/\bsgt\b\.?/g, 'sargento'],
        [/\best\b\.?/g, 'estrada'],
        [/\brod\b\.?/g, 'rodovia']
    ];

    for (const [regex, replacement] of replacements) {
        q = q.replace(regex, replacement);
    }

    return q.trim();
}

// Extrai/constrói informações estruturadas do logradouro a partir das propriedades da feature
function getFeatureStreetInfo(props) {
    if (!props) return null;

    let fullName = '';
    let streetOnly = '';
    let tipLog = props.NM_TIP_LOG || '';
    let titLog = props.NM_TIT_LOG || '';
    let munName = getMunicipalityName(props.CD_SETOR || props.CD_MUN);

    // Formato padrão Censo IBGE (rmbh.geojson)
    if (props.NM_LOG) {
        streetOnly = props.NM_LOG.trim();
        const parts = [tipLog, titLog, streetOnly].filter(Boolean);
        fullName = parts.join(' ');
    } else {
        fullName = props.NM_LOGRADOURO || 
                   props.logradouro || 
                   props.nome || 
                   props.name || 
                   props.LOGRADOURO || 
                   props.RUAS || 
                   '';
        streetOnly = fullName;
    }

    if (!fullName) return null;

    return {
        fullName: fullName.trim(),
        streetOnly: streetOnly.trim(),
        tipLog: tipLog.trim(),
        titLog: titLog.trim(),
        munName: munName,
        totalRes: Number(props.TOT_RES) || 0,
        totalGeral: Number(props.TOT_GERAL) || 0,
        cdSetor: props.CD_SETOR || ''
    };
}

// Extrai o nome textual simples do logradouro
function getFeatureStreetName(props) {
    const info = getFeatureStreetInfo(props);
    return info ? info.fullName : '';
}


// Função utilitária de notificações Toast (não bloqueantes)
function showToast(message, type = 'info', duration = 3000) {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Indicador de status online/offline
function updateOnlineStatus() {
    const indicator = document.getElementById('status-indicator');
    if (!indicator) return;
    if (navigator.onLine) {
        indicator.textContent = 'Online';
        indicator.className = 'status-indicator online';
    } else {
        indicator.textContent = 'Offline';
        indicator.className = 'status-indicator offline';
    }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// Helpers para cálculos de coordenadas de Tiles
function getTileBoundsForZoom(bounds, zoom) {
    const nw = bounds.getNorthWest();
    const se = bounds.getSouthEast();
    const minX = long2tile(nw.lng, zoom);
    const maxX = long2tile(se.lng, zoom);
    const minY = lat2tile(se.lat, zoom);
    const maxY = lat2tile(nw.lat, zoom);
    return { minX, maxX, minY, maxY };
}

function long2tile(lon, zoom) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
    return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
}

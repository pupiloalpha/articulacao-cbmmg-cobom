# 🗺️ GIS PWA Offline – Articulação CBMMG

Aplicação web progressiva (PWA) para visualização, gestão e análise de dados geoespaciais, desenvolvida para o **COBOM-BH (Corpo de Bombeiros Militar de Minas Gerais)**. Permite operar totalmente offline, com suporte a camadas GeoJSON, KML/KMZ, cache de tiles OpenStreetMap, cálculo de distâncias (linha reta e rotas) e ferramentas administrativas.

---

## 🚀 Funcionalidades

- **Mapa interativo** com cache offline de tiles (OpenStreetMap)
- **Camadas vetoriais** (pontos, polígonos, linhas) em GeoJSON
- **Importação de arquivos KML/KMZ** (arrastar e soltar)
- **Desenho de pontos (POI) e polígonos** diretamente no mapa
- **Pesquisa de endereços** (online com Nominatim, offline com cache local)
- **Cálculo de distâncias**:
  - Em linha reta (via Turf.js)
  - Rotas reais (via OSRM, com cache em IndexedDB)
- **Origem dinâmica**: defina o ponto de origem por:
  - Clique no mapa
  - Busca de endereço
  - Localização GPS
  - Clique em uma feição
- **Ferramentas administrativas**:
  - Autenticação por PIN (hash SHA‑256)
  - Gerenciamento de camadas (visibilidade, exclusão)
  - Exportação/importação de backup completo (JSON)
  - Download programático de tiles para uso offline
  - Limpeza do cache de rotas
- **Modos de visualização**: todas as feições, apenas pontos, ou nenhuma
- **Zoom para todas as feições** com um clique
- **Indicador de status online/offline**
- **Design responsivo** com sidebar colapsável
- **Service Worker** para cache de assets estáticos (PWA)

---

## 🛠️ Tecnologias Utilizadas

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Bibliotecas**:
  - [Leaflet](https://leafletjs.com/) – renderização do mapa
  - [Leaflet Routing Machine](https://www.l-leaflet.com/) – rotas
  - [Dexie](https://dexie.org/) – abstração do IndexedDB
  - [Turf.js](https://turfjs.org/) – operações geoespaciais
  - [JSZip](https://stuk.github.io/jszip/) – leitura de KMZ
  - [togeojson](https://github.com/mapbox/togeojson) – conversão KML → GeoJSON
- **Armazenamento offline**:
  - IndexedDB (camadas, endereços, tiles, rotas em cache)
  - Cache API (Service Worker para assets estáticos)
- **APIs externas** (online):
  - [Nominatim](https://nominatim.org/) – geocodificação
  - [OSRM](https://project-osrm.org/) – cálculo de rotas

---

## 📦 Instalação e Execução

### Pré-requisitos
- Navegador moderno com suporte a Service Worker, IndexedDB e Fetch API (Chrome, Firefox, Edge, Opera).
- (Opcional) Servidor HTTP para testes locais (ex: Live Server, Python http.server).

### Passos
1. Clone o repositório:
   ```bash
   git clone https://github.com/seu-usuario/gis-pwa-offline.git
   cd gis-pwa-offline
   ```

2. Inicie um servidor local na raiz do projeto. Exemplo com Python:
   ```bash
   python3 -m http.server 8000
   ```
   Ou use a extensão Live Server do VS Code.

3. Acesse `http://localhost:8000` no navegador.

> **Nota**: Para funcionamento completo offline, instale a aplicação como PWA (pelo navegador) ou utilize o modo offline após o primeiro carregamento.

---

## 🔐 Administração

O acesso às ferramentas administrativas é protegido por um **PIN**. Na primeira execução, o sistema solicitará a definição de um PIN (armazenado como hash SHA‑256 no `localStorage`). Nos acessos seguintes, utilize o mesmo PIN para fazer login.

### Funcionalidades Admin
- **Upload de KML/KMZ**: arraste arquivos ou clique na área designada.
- **Adicionar POI**: clique no botão e depois no mapa para inserir um ponto.
- **Desenhar polígono**: clique no botão, adicione vértices no mapa e finalize com o mesmo botão.
- **Exportar/Importar backup**: salva todas as camadas e endereços em um arquivo JSON.
- **Limpar cache de rotas**: remove todas as rotas armazenadas.
- **Baixar tiles offline**: selecione a faixa de zoom e baixe os tiles da área visível no mapa.

---

## 🗂️ Estrutura do Projeto

```
/
├── index.html          # Página principal e estrutura HTML
├── styles.css          # Estilos da aplicação
├── app.js              # Lógica principal (mapa, interações, UI)
├── db.js               # Gerenciamento IndexedDB (Dexie)
├── sw.js               # Service Worker (cache de assets)
├── manifest.json       # Configuração PWA
├── data/
│   └── backup_inicial.json  # Dados de exemplo (opcional)
├── icons/              # Ícones para PWA
│   ├── icon-192.png
│   └── icon-512.png
└── README.md           # Este arquivo
```

---

## 🧩 Como Usar

### Definir uma origem
- **Busca**: digite um endereço e clique em "Buscar Endereço" ou pressione Enter.
- **GPS**: clique em "📍 Minha Localização".
- **Mapa**: clique em "🎯 Definir origem no mapa" e depois clique em qualquer ponto do mapa.
- **Clique em uma feição**: se não houver origem definida, clicar em um ponto a define automaticamente.

Após definir a origem, a aplicação calcula e exibe:
- Os 10 pontos mais próximos em linha reta.
- Polígonos que contêm a origem (se houver).

### Visualizar distância para um ponto
Nos resultados de distância, clique em qualquer item para focar o mapa e desenhar uma linha (reta ou rota) entre a origem e o destino. Se estiver online, será utilizada a rota real (com cache); offline, apenas a linha reta.

### Gerenciar camadas
Na lista de camadas, cada entrada possui:
- Um botão de visibilidade (👁️ / 👁️‍🗨️) para mostrar/ocultar.
- (Admin) um botão de exclusão (🗑️).

### Controles de visualização
Use os checkboxes para filtrar a exibição:
- **Todas**: mostra todos os tipos de geometria.
- **Pontos**: exibe apenas feições do tipo `Point`.
- **Limpo**: oculta todas as feições (mantém apenas o mapa base).

---

## 🧠 Armazenamento Offline

- **Tiles OSM**: armazenados em IndexedDB (tabela `tiles`). A classe `OfflineTileLayer` no `app.js` gerencia a busca e o cache.
- **Camadas**: salvas em IndexedDB (tabela `layers`) como objetos GeoJSON completos.
- **Endereços**: resultados de busca são salvos (tabela `addresses`) para uso offline.
- **Rotas**: distâncias e durações calculadas via OSRM são cacheadas (tabela `routes`) para reduzir chamadas de rede.

---

## 🤝 Contribuição

Contribuições são bem-vindas! Siga os passos:

1. Faça um fork do projeto.
2. Crie uma branch para sua feature (`git checkout -b feature/nova-funcionalidade`).
3. Commit suas alterações (`git commit -am 'Adiciona nova funcionalidade'`).
4. Push para a branch (`git push origin feature/nova-funcionalidade`).
5. Abra um Pull Request.

---

## 📄 Licença

Este projeto está licenciado sob a [MIT License](LICENSE). Sinta-se à vontade para usar, modificar e distribuir.

---

## 📬 Contato

Dúvidas ou sugestões? Entre em contato com a equipe do COBOM-BH ou abra uma issue no GitHub.

---

**Desenvolvido para uso operacional do Corpo de Bombeiros Militar de Minas Gerais.**

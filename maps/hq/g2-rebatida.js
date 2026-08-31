/**
 * G2.2 - Rebatida do corredor.
 * Uma bola fica no corredor e rola quando um avatar esbarra nela.
 * Onde ela estiver na primeira entrada do dia vira o ponto de encontro,
 * marcado no chao para todo mundo.
 */
WA.onInit().then(function () {
  var CAMADA = "floor/g2-bola";
  var TILE_BOLA = 2968; // HQ_Marcadores: bola ciano
  var TILE_ENCONTRO = 2969; // HQ_Marcadores: marcacao de piso
  var CORREDOR_Y = 17;
  var X_MIN = 11;
  var X_MAX = 26;
  var estado = null;
  var ultimoTile = null;

  function hoje() { return new Date().toISOString().slice(0, 10); }

  function ler() {
    try { return JSON.parse(WA.state.hq_bola || "null"); } catch (e) { return null; }
  }

  function gravar(novo) {
    estado = novo;
    WA.state.saveVariable("hq_bola", JSON.stringify(novo));
  }

  function desenhar() {
    if (!estado) return;
    var tiles = [{ x: estado.x, y: CORREDOR_Y, tile: TILE_BOLA, layer: CAMADA }];
    if (estado.encontro !== null && estado.encontro !== undefined && estado.encontro !== estado.x) {
      tiles.push({ x: estado.encontro, y: CORREDOR_Y, tile: TILE_ENCONTRO, layer: CAMADA });
    }
    WA.room.setTiles(tiles);
  }

  function apagar(x) {
    if (x === null || x === undefined) return;
    if (estado && estado.encontro === x) return;
    WA.room.setTiles([{ x: x, y: CORREDOR_Y, tile: null, layer: CAMADA }]);
  }

  function abrirDia() {
    var atual = ler();
    if (!atual) atual = { x: Math.floor((X_MIN + X_MAX) / 2), dia: hoje(), encontro: null };
    if (atual.dia !== hoje()) {
      atual.encontro = atual.x;
      atual.dia = hoje();
      WA.ui.banner.openBanner({
        id: "bola-encontro",
        text: "A bola dormiu no corredor. Ponto de encontro de hoje marcado no chao.",
        closable: true,
        timeToClose: 7000
      });
    }
    gravar(atual);
    desenhar();
  }

  function empurrar(direcao) {
    var alvo = estado.x + direcao;
    var passos = 0;
    while (alvo >= X_MIN && alvo <= X_MAX && passos < 3) {
      passos++;
      if (alvo + direcao < X_MIN || alvo + direcao > X_MAX) break;
      alvo += direcao;
    }
    if (alvo < X_MIN) alvo = X_MIN;
    if (alvo > X_MAX) alvo = X_MAX;
    if (alvo === estado.x) return;
    var antigo = estado.x;
    estado.x = alvo;
    gravar(estado);
    apagar(antigo);
    desenhar();
    console.info("[G2] rebatida: bola " + antigo + " -> " + estado.x);
  }

  abrirDia();

  WA.state.onVariableChange("hq_bola").subscribe(function () {
    var antigo = estado ? estado.x : null;
    estado = ler();
    if (antigo !== null && estado && antigo !== estado.x) apagar(antigo);
    desenhar();
  });

  WA.player.onPlayerMove(function (posicao) {
    if (!estado) return;
    var tx = Math.floor(posicao.x / 32);
    var ty = Math.floor(posicao.y / 32);
    var chave = tx + ":" + ty;
    if (chave === ultimoTile) return;
    ultimoTile = chave;
    if (ty !== CORREDOR_Y) return;
    if (tx === estado.x - 1) empurrar(1);
    else if (tx === estado.x + 1) empurrar(-1);
  });

  console.info("[G2] rebatida do corredor carregada");
}).catch(function (e) { console.error("[G2] rebatida erro", e); });

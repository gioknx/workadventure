/**
 * G2.3 - Rastro de confete no corredor.
 * Quem ganha a partida na sala de lazer sai com confete grudado por 20 min:
 * o chao vai ficando pintado por onde o avatar passa, no mapa todo.
 */
WA.onInit().then(function () {
  var CAMADA = "floor/g2-confete";
  var TILE_CONFETE = 2971; // HQ_Marcadores: confete colorido
  var DURACAO = 20 * 60 * 1000;
  var RASTRO_MAX = 40;
  var rastro = [];
  var ultimoTile = null;
  var alarme = null;

  function ate() { return Number(WA.player.state.hq_confete_ate) || 0; }
  function ativo() { return ate() > Date.now(); }

  function banner(texto) {
    WA.ui.banner.openBanner({ id: "confete", text: texto, closable: true, timeToClose: 7000 });
  }

  function limparRastro() {
    if (rastro.length === 0) return;
    WA.room.setTiles(rastro.map(function (t) {
      return { x: t.x, y: t.y, tile: null, layer: CAMADA };
    }));
    rastro = [];
  }

  function agendarLimpeza() {
    clearTimeout(alarme);
    var falta = ate() - Date.now();
    if (falta <= 0) return;
    alarme = setTimeout(function () {
      limparRastro();
      console.info("[G2] confete: prazo vencido, rastro apagado");
    }, falta);
  }

  agendarLimpeza();

  WA.room.area.onEnter("lazer-jogo").subscribe(function () {
    if (ativo()) {
      banner("Voce ainda esta soltando confete. Faltam " + Math.ceil((ate() - Date.now()) / 60000) + " min.");
      return;
    }
    var ganhou = Math.random() < 0.5;
    if (!ganhou) {
      banner("Perdeu a partida. Sem confete dessa vez.");
      console.info("[G2] confete: partida perdida");
      return;
    }
    WA.player.state.saveVariable("hq_confete_ate", Date.now() + DURACAO);
    banner("Ganhou! Confete grudado por 20 minutos - olhe o chao por onde voce passar.");
    console.info("[G2] confete: partida ganha, rastro ativo por 20 min");
  });

  WA.player.onPlayerMove(function (posicao) {
    if (!ativo()) {
      limparRastro();
      return;
    }
    var tx = Math.floor(posicao.x / 32);
    var ty = Math.floor(posicao.y / 32);
    var chave = tx + ":" + ty;
    if (chave === ultimoTile) return;
    ultimoTile = chave;
    rastro.push({ x: tx, y: ty });
    WA.room.setTiles([{ x: tx, y: ty, tile: TILE_CONFETE, layer: CAMADA }]);
    if (rastro.length > RASTRO_MAX) {
      var velho = rastro.shift();
      WA.room.setTiles([{ x: velho.x, y: velho.y, tile: null, layer: CAMADA }]);
    }
  });

  console.info("[G2] rastro de confete carregado");
}).catch(function (e) { console.error("[G2] confete erro", e); });

/**
 * F1.1 - Pino de humor na entrada.
 * Parar numa faixa do lobby grava seu humor do dia e pinta um marcador na faixa.
 */
WA.onInit().then(function () {
  var FAIXAS = {
    "humor-otimo": { tx: 13 }, "humor-bem": { tx: 14 },
    "humor-neutro": { tx: 15 }, "humor-ruim": { tx: 16 }
  };
  var GID_MARCADOR = 2683; // WA_User_Interface, primeiro tile
  var LINHA = 17; // y=544 em tiles

  function estado() {
    try { return JSON.parse(WA.state.hq_humor || "{}"); } catch (e) { return {}; }
  }
  function repintar() {
    var e = estado(), tiles = [];
    Object.keys(FAIXAS).forEach(function (f) {
      tiles.push({ x: FAIXAS[f].tx, y: LINHA, tile: null, layer: "f1-marcadores" });
    });
    Object.keys(e).forEach(function (quem) {
      var f = FAIXAS[e[quem]];
      if (f) tiles.push({ x: f.tx, y: LINHA, tile: GID_MARCADOR, layer: "f1-marcadores" });
    });
    WA.room.setTiles(tiles);
  }
  Object.keys(FAIXAS).forEach(function (faixa) {
    WA.room.area.onEnter(faixa).subscribe(function () {
      var e = estado();
      e[WA.player.name] = faixa;
      WA.state.saveVariable("hq_humor", JSON.stringify(e));
      WA.ui.banner.openBanner({ id: "humor", text: "Humor registrado: " + faixa.replace("humor-", ""), closable: true, timeToClose: 3000 });
    });
  });
  WA.state.onVariableChange("hq_humor").subscribe(repintar);
  repintar();
  console.info("[F1] pino de humor carregado");
}).catch(function (e) { console.error("[F1] pino erro", e); });

/**
 * G2.1 - Musgo do que ninguem le.
 * Nota do Vault parada ha muito tempo cobre de musgo a estante correspondente.
 * Passar por cima limpa o musgo e mostra a nota esquecida.
 */
WA.onInit().then(function () {
  var SERVIDOR = "http://localhost:8900/musgo";
  var CAMADA = "floor/g2-musgo";
  var TILE_MUSGO = 6; // WA_Special_Zones, verde
  var ESTANTES = [
    { zona: "estante-1", x: 22, y: 17 },
    { zona: "estante-2", x: 24, y: 17 },
    { zona: "estante-3", x: 26, y: 17 }
  ];
  var mapa = {};

  function limpas() {
    try { return JSON.parse(WA.player.state.hq_musgo_limpo || "[]"); } catch (e) { return []; }
  }

  function pintar(estante, verde) {
    WA.room.setTiles([{ x: estante.x, y: estante.y, tile: verde ? TILE_MUSGO : null, layer: CAMADA }]);
  }

  function banner(texto) {
    WA.ui.banner.openBanner({ id: "musgo", text: texto, closable: true, timeToClose: 7000 });
  }

  fetch(SERVIDOR)
    .then(function (r) { return r.json(); })
    .then(function (dados) {
      var ja = limpas();
      var cobertas = 0;
      (dados.estantes || []).forEach(function (nota, i) {
        var estante = ESTANTES[i];
        if (!estante) return;
        mapa[estante.zona] = nota;
        var suja = ja.indexOf(nota.titulo) === -1;
        pintar(estante, suja);
        if (suja) cobertas++;
      });
      console.info("[G2] musgo: " + cobertas + " estante(s) cobertas de " + (dados.totalNotas || 0) + " notas");
      if (cobertas > 0) {
        WA.room.area.onEnter("Biblioteca").subscribe(function () {
          banner(cobertas + " estante(s) cobertas de musgo. Passe por cima para reabrir o livro.");
        });
      }
    })
    .catch(function (e) { console.error("[G2] musgo servidor fora", e); });

  ESTANTES.forEach(function (estante) {
    WA.room.area.onEnter(estante.zona).subscribe(function () {
      var nota = mapa[estante.zona];
      if (!nota) return;
      var ja = limpas();
      if (ja.indexOf(nota.titulo) === -1) {
        ja.push(nota.titulo);
        WA.player.state.saveVariable("hq_musgo_limpo", JSON.stringify(ja));
        pintar(estante, false);
      }
      banner('"' + nota.titulo + '" (' + nota.pasta + ") - " + nota.dias + " dias sem abrir. Musgo limpo.");
      console.info("[G2] musgo limpo: " + nota.titulo + " (" + nota.dias + " dias)");
    });
  });
}).catch(function (e) { console.error("[G2] musgo erro", e); });

/**
 * F1.2 - Placa que voce mesmo escreve.
 * Pisar na placa da mesa mostra o texto atual e abre o editor.
 */
WA.onInit().then(function () {
  var site = null;
  WA.room.area.onEnter("placa-mesa").subscribe(function () {
    var txt = WA.state.hq_placa_mesa || "(placa em branco)";
    WA.ui.banner.openBanner({ id: "placa", text: "Placa: " + txt, closable: true, timeToClose: 5000 });
    WA.ui.website.open({
      url: "http://maps.workadventure.test/hq/placa.html",
      position: { vertical: "middle", horizontal: "middle" },
      size: { height: "180px", width: "340px" },
      allowApi: true
    }).then(function (w) { site = w; });
  });
  WA.room.area.onLeave("placa-mesa").subscribe(function () {
    if (site) { site.close(); site = null; }
  });
  console.info("[F1] placa carregada");
}).catch(function (e) { console.error("[F1] placa erro", e); });

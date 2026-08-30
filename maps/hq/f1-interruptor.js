/**
 * F1.3 - Interruptor de fim de expediente.
 * Pisar alterna a luz do HQ inteiro; quem chega com tudo escuro ve o mundo acender.
 */
WA.onInit().then(function () {
  function aplicar(v) {
    if (v === "off") { WA.room.showLayer("luz-apagada"); } else { WA.room.hideLayer("luz-apagada"); }
  }
  WA.room.area.onEnter("interruptor").subscribe(function () {
    var novo = (WA.state.hq_luz === "off") ? "on" : "off";
    WA.state.saveVariable("hq_luz", novo);
    WA.ui.banner.openBanner({ id: "luz", text: novo === "off" ? "Voce apagou o HQ. Bom descanso." : "Luzes acesas.", closable: true, timeToClose: 3000 });
  });
  WA.state.onVariableChange("hq_luz").subscribe(aplicar);
  if (WA.state.hq_luz === "off") {
    aplicar("off");
    setTimeout(function () { WA.state.saveVariable("hq_luz", "on"); }, 2500);
  } else { aplicar("on"); }
  console.info("[F1] interruptor carregado");
}).catch(function (e) { console.error("[F1] interruptor erro", e); });

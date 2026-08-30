/**
 * F1.4 - Maquina de cafe que puxa conversa.
 * A cafeteira lembra quem pegou o ultimo cafe e conta pra quem chega.
 */
WA.onInit().then(function () {
  function ler() {
    try { return JSON.parse(WA.state.hq_cafe || "{}"); } catch (e) { return {}; }
  }
  WA.room.area.onEnter("cafeteira").subscribe(function () {
    var c = ler(), agora = new Date(), frase;
    var hoje = agora.toISOString().slice(0, 10);
    if (!c.ultimo || c.ultimo.dia !== hoje) {
      frase = "Primeiro cafe de hoje. A casa estava esperando.";
    } else {
      var h = new Date(c.ultimo.quando);
      frase = "Ultimo cafe: " + c.ultimo.quem + " as " + ("0"+h.getHours()).slice(-2) + ":" + ("0"+h.getMinutes()).slice(-2) + ". Total da casa: " + (c.total || 0) + ".";
    }
    WA.ui.banner.openBanner({ id: "cafe", text: frase, closable: true, timeToClose: 6000 });
    WA.state.saveVariable("hq_cafe", JSON.stringify({
      total: (c.total || 0) + 1,
      ultimo: { quem: WA.player.name, quando: Date.now(), dia: hoje }
    }));
  });
  console.info("[F1] cafeteira carregada");
}).catch(function (e) { console.error("[F1] cafe erro", e); });

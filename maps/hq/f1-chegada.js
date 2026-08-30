/**
 * F1.5 - Chegada guiada.
 * Quatro marcos entre o spawn e a mesa; cada um fala uma vez por sessao.
 */
WA.onInit().then(function () {
  var MARCOS = {
    "marco-1": "Bem-vindo ao HQ. Siga em frente - o mundo reage a voce.",
    "marco-2": "Estas faixas sao o pino de humor: pare na que descreve seu dia.",
    "marco-3": "A cafeteira ali lembra quem pegou o ultimo cafe. Experimente.",
    "marco-4": "Sua mesa. A placa ao lado e sua: pise nela e escreva no que esta trabalhando."
  };
  var falados = {};
  Object.keys(MARCOS).forEach(function (m) {
    WA.room.area.onEnter(m).subscribe(function () {
      if (falados[m]) return;
      falados[m] = true;
      WA.ui.banner.openBanner({ id: m, text: MARCOS[m], closable: true, timeToClose: 6000 });
    });
  });
  console.info("[F1] chegada guiada carregada");
}).catch(function (e) { console.error("[F1] chegada erro", e); });

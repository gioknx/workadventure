/**
 * Sino global de vendas — recebe o evento nativo do WorkAdventure em qualquer sala.
 */

const SINO_LAYER = "sino-global";
const SINO_X = 18;
const SINO_Y = 11;
const SINO_REPOUSO = 2974;
const SINO_ATIVO = 2975;

WA.onInit()
  .then(function () {
    const som = WA.sound.loadSound("sons/sino.mp3");
    let timerContorno = null;

    function animarSino() {
      let passo = 0;
      function proximo() {
        const tile = passo % 2 === 0 ? SINO_ATIVO : SINO_REPOUSO;
        try {
          WA.room.setTiles([{ x: SINO_X, y: SINO_Y, tile, layer: SINO_LAYER }]);
        } catch (erro) {
          console.info("[HQ-VENDA] sala sem objeto visual do Sino");
          return;
        }
        passo += 1;
        if (passo < 6) setTimeout(proximo, 180);
      }
      proximo();
    }

    function destacarAtivador(nome) {
      if (String(WA.player.name || "").toLowerCase() !== String(nome || "").toLowerCase()) return;
      clearTimeout(timerContorno);
      WA.player.setOutlineColor(255, 215, 0).catch(function (erro) {
        console.error("[HQ-VENDA] falha ao destacar ativador", erro);
      });
      timerContorno = setTimeout(function () {
        WA.player.removeOutlineColor().catch(function (erro) {
          console.error("[HQ-VENDA] falha ao retirar destaque", erro);
        });
      }, 60000);
    }

    WA.event.on("hq-venda").subscribe(function (evento) {
      const dados = (evento && (evento.data || evento.value)) || {};
      const nome = dados.ativador_nome || "Ativador";
      const squad = dados.squad || "sem squad";
      try {
        const caminho = som.play({ volume: 0.72 });
        console.info("[HQ-VENDA] som " + caminho);
      } catch (erro) {
        console.error("[HQ-VENDA] falha ao tocar som", erro);
      }
      animarSino();
      WA.ui.banner.openBanner({
        id: "hq-venda",
        text: "🔔 VENDA · " + nome + " · " + squad,
        bgColor: dados.squad_cor || "#8A6D1D",
        textColor: "#ffffff",
        closable: true,
        timeToClose: 8000,
      });
      destacarAtivador(nome);
      console.info("[HQ-VENDA] evento " + nome + " · " + squad);
    });

    console.info("[HQ-VENDA] Sino global pronto");
  })
  .catch(function (erro) {
    console.error("[HQ-VENDA] falha ao iniciar", erro);
  });

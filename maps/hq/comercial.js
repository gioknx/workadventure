const AREAS_COMERCIAIS = [
  "sala-zeca",
  "sala-th",
  "sala-fernando",
  "sala-xyz",
  "sala-vip",
];

const ADMIN_API_COMERCIAL = "http://localhost:8901";
const RECUO_VIP = { x: 20 * 32, y: 9 * 32 };

async function chamarAdmin(caminho, opcoes) {
  const resposta = await fetch(`${ADMIN_API_COMERCIAL}${caminho}`, opcoes);
  if (!resposta.ok) throw new Error(`Admin API respondeu ${resposta.status}`);
  return await resposta.json();
}

WA.onInit()
  .then(function () {
    console.info("[COMERCIAL] mapa carregado");
    AREAS_COMERCIAIS.forEach(function (area) {
      WA.room.area.onEnter(area).subscribe(function () {
        console.info("[COMERCIAL] entrou " + area);
      });
    });

    let validandoVip = false;
    WA.room.area.onEnter("sala-vip").subscribe(async function () {
      if (validandoVip) return;
      validandoVip = true;
      const nome = String(WA.player.name || "").trim();
      try {
        const vip = await chamarAdmin("/vip");
        let pessoa = null;
        try {
          pessoa = await chamarAdmin(`/pessoas/${encodeURIComponent(nome)}`);
        } catch (erro) {
          if (!erro.message.includes("404")) throw erro;
        }
        if (vip.squad_vencedor && pessoa?.squad === vip.squad_vencedor) {
          WA.ui.banner.openBanner({
            id: "vip-autorizada",
            text: `Sala VIP · acesso do squad ${vip.squad_vencedor}`,
            bgColor: "#8A6D1D",
            textColor: "#ffffff",
            closable: true,
            timeToClose: 4000,
          });
          return;
        }
        await chamarAdmin("/vip/invasao", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome }),
        });
        WA.ui.banner.openBanner({
          id: "vip-negada",
          text: vip.squad_vencedor
            ? `Sala VIP reservada ao squad ${vip.squad_vencedor}`
            : "Sala VIP aguardando o primeiro fechamento semanal",
          bgColor: "#7f1d1d",
          textColor: "#ffffff",
          closable: true,
          timeToClose: 5000,
        });
        await WA.player.teleport(RECUO_VIP.x, RECUO_VIP.y);
      } catch (erro) {
        console.error("[COMERCIAL] falha ao validar VIP", erro);
        await WA.player.teleport(RECUO_VIP.x, RECUO_VIP.y);
      } finally {
        validandoVip = false;
      }
    });

    let placarSite = null;
    WA.room.area.onEnter("placar").subscribe(function () {
      if (placarSite) return;
      WA.ui.website.open({
        url: "http://maps.workadventure.test/hq/placar.html?v=nv1f3",
        position: { vertical: "middle", horizontal: "middle" },
        size: { height: "620px", width: "760px" },
        allowApi: false,
      }).then(function (site) {
        placarSite = site;
      });
    });
    WA.room.area.onLeave("placar").subscribe(function () {
      if (placarSite) {
        placarSite.close();
        placarSite = null;
      }
    });

    let lojaSite = null;
    WA.room.area.onEnter("loja").subscribe(function () {
      if (lojaSite) return;
      const nome = encodeURIComponent(String(WA.player.name || "").trim());
      WA.ui.website.open({
        url: `http://maps.workadventure.test/hq/loja.html?v=nv1f4&nome=${nome}`,
        position: { vertical: "middle", horizontal: "middle" },
        size: { height: "660px", width: "920px" },
        allowApi: false,
      }).then(function (site) {
        lojaSite = site;
      });
    });
    WA.room.area.onLeave("loja").subscribe(function () {
      if (lojaSite) {
        lojaSite.close();
        lojaSite = null;
      }
    });
  })
  .catch(function (erro) {
    console.error("[COMERCIAL] falha ao iniciar", erro);
  });

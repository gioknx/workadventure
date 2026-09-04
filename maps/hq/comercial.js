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

function identidade() {
  return {
    nome: String(WA.player.name || "").trim(),
    uuid: String(WA.player.uuid || "").trim(),
  };
}

// Primeiro login casa o nome do cadastro com o uuid do jogador. Idempotente:
// 200 ja_vinculado quando repete, 409 quando o nome pertence a outro uuid.
async function vincularIdentidade() {
  const { nome, uuid } = identidade();
  if (!nome || !uuid) return;
  const resposta = await fetch(`${ADMIN_API_COMERCIAL}/api/pessoas/vincular`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome, uuid }),
  });
  const corpo = await resposta.json().catch(() => ({}));
  console.info(`[COMERCIAL] vincular ${resposta.status} ${corpo.status || corpo.erro || ""}`);
}

WA.onInit()
  .then(function () {
    console.info("[COMERCIAL] mapa carregado");
    AREAS_COMERCIAIS.forEach(function (area) {
      WA.room.area.onEnter(area).subscribe(function () {
        console.info("[COMERCIAL] entrou " + area);
      });
    });

    vincularIdentidade().catch(function (erro) {
      console.error("[COMERCIAL] falha ao vincular identidade", erro);
    });

    let validandoVip = false;
    WA.room.area.onEnter("sala-vip").subscribe(async function () {
      if (validandoVip) return;
      validandoVip = true;
      const { nome, uuid } = identidade();
      try {
        // Quem decide e' o servidor; o cliente so exibe e recua.
        const resposta = await fetch(
          `${ADMIN_API_COMERCIAL}/api/vip/acesso?uuid=${encodeURIComponent(uuid)}&nome=${encodeURIComponent(nome)}`,
        );
        if (resposta.status !== 200 && resposta.status !== 403) {
          throw new Error(`Admin API respondeu ${resposta.status}`);
        }
        const veredito = await resposta.json();
        if (veredito.acesso) {
          WA.ui.banner.openBanner({
            id: "vip-autorizada",
            text: `Sala VIP · acesso do squad ${veredito.squad_vencedor}`,
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
          body: JSON.stringify({ nome, uuid }),
        });
        WA.ui.banner.openBanner({
          id: "vip-negada",
          text: veredito.squad_vencedor
            ? `Sala VIP reservada ao squad ${veredito.squad_vencedor}`
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
      const { nome, uuid } = identidade();
      const query = `nome=${encodeURIComponent(nome)}&uuid=${encodeURIComponent(uuid)}`;
      WA.ui.website.open({
        url: `http://maps.workadventure.test/hq/loja.html?v=nv1f5&${query}`,
        position: { vertical: "middle", horizontal: "middle" },
        size: { height: "500px", width: "920px" },
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

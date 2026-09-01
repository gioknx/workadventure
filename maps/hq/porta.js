/**
 * Porta da Diretoria — a decisão visual consulta o mesmo cadastro que a
 * Admin API usa para bloquear o mapa fechado no servidor.
 */

const ADMIN_API = "http://localhost:8901";
const SALA_DIRETORIA = "diretoria-fechada.tmj#from-hq";
const VOLTA = { x: 26.5 * 32, y: 11.5 * 32 };

async function consultar(caminho) {
  const resposta = await fetch(`${ADMIN_API}${caminho}`);
  if (!resposta.ok) throw new Error(`API respondeu ${resposta.status}`);
  return await resposta.json();
}

function avisar(id, text, bgColor, timeToClose = 4000) {
  WA.ui.banner.openBanner({
    id,
    text,
    bgColor,
    textColor: "#ffffff",
    closable: true,
    timeToClose,
  });
}

WA.onInit().then(() => {
  let verificando = false;
  let navegando = false;

  const verificarEntrada = async () => {
    if (verificando || navegando) return;
    verificando = true;
    try {
      const { modo } = await consultar("/diretoria/modo");
      if (modo === "aberta") {
        navegando = true;
        await WA.nav.goToRoom(SALA_DIRETORIA);
        return;
      }

      const nome = String(WA.player.name || "").trim();
      let pessoa = null;
      try {
        pessoa = await consultar(`/pessoas/${encodeURIComponent(nome)}`);
      } catch (erro) {
        if (!erro.message.includes("404")) throw erro;
      }
      if (Array.isArray(pessoa?.tags) && pessoa.tags.includes("diretoria")) {
        navegando = true;
        await WA.nav.goToRoom(SALA_DIRETORIA);
        return;
      }

      avisar("porta-trancada", "Diretoria fechada — sua identidade não tem autorização.", "#8f2b2b", 5000);
      await WA.player.teleport(VOLTA.x, VOLTA.y);
    } catch (erro) {
      avisar("porta-indisponivel", "Diretoria indisponível — não foi possível confirmar sua autorização.", "#8f2b2b", 5000);
      await WA.player.teleport(VOLTA.x, VOLTA.y);
      console.error("[porta] falha ao consultar autorização:", erro);
    } finally {
      verificando = false;
    }
  };

  WA.room.area.onEnter("PortaDiretoria").subscribe(verificarEntrada);
  WA.room.area.onEnter("Diretoria").subscribe(verificarEntrada);

  console.log("[porta] Diretoria fechada; autorização canônica ativa.");
});

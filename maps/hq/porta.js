/**
 * Porta da Diretoria — a Diretoria e uma area DENTRO do HQ, nao outra sala.
 * Quem decide e o servidor (tag + modo); o cliente so barra e avisa.
 */

const ADMIN_API = "http://localhost:8901";
// Tile (26,11): o corredor logo abaixo da porta, ja fora da Diretoria.
const VOLTA = { x: 26.5 * 32, y: 11.5 * 32 };

function avisar(id, text, bgColor, timeToClose = 5000) {
  WA.ui.banner.openBanner({
    id,
    text,
    bgColor,
    textColor: "#ffffff",
    closable: true,
    timeToClose,
  });
}

async function consultarAcesso(nome) {
  const resposta = await fetch(
    `${ADMIN_API}/api/diretoria/acesso?nome=${encodeURIComponent(nome)}`,
  );
  if (resposta.status === 200) return { acesso: true };
  if (resposta.status === 403) {
    const corpo = await resposta.json().catch(() => ({}));
    return { acesso: false, motivo: corpo.motivo ?? "sem autorizacao" };
  }
  throw new Error(`API respondeu ${resposta.status}`);
}

WA.onInit().then(() => {
  let verificando = false;

  const barrar = async (texto, id) => {
    avisar(id, texto, "#8f2b2b", 5000);
    await WA.player.teleport(VOLTA.x, VOLTA.y);
  };

  const verificarEntrada = async () => {
    if (verificando) return;
    verificando = true;
    try {
      const nome = String(WA.player.name || "").trim();
      const veredito = await consultarAcesso(nome);
      if (veredito.acesso) {
        console.log(`[porta] acesso liberado para ${nome}`);
        return;
      }
      console.log(`[porta] acesso NEGADO para ${nome}: ${veredito.motivo}`);
      await barrar("Diretoria — acesso restrito. Fale com o Mind.", "porta-trancada");
    } catch (erro) {
      console.error("[porta] falha ao consultar autorizacao:", erro);
      await barrar(
        "Diretoria — acesso restrito. Fale com o Mind.",
        "porta-indisponivel",
      );
    } finally {
      verificando = false;
    }
  };

  WA.room.area.onEnter("PortaDiretoria").subscribe(verificarEntrada);
  WA.room.area.onEnter("Diretoria").subscribe(verificarEntrada);

  console.log("[porta] barreira da Diretoria ativa (decisao no servidor).");
});

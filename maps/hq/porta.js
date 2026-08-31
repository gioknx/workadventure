/**
 * Porta da Diretoria — a sala fica visível, mas a soleira é seletiva.
 * Autoriza papéis vindos da room API, nomes locais de desenvolvimento ou convite por URL.
 */

const CONVIDADOS = ["Mind", "Gio", "Giovani"];
const PAPEIS_AUTORIZADOS = new Set(["dono", "admin", "diretoria"]);
const CODIGO = "DIRETORIA";
const VOLTA = { x: 26.5 * 32, y: 11.5 * 32 };

function referenciasDaPagina() {
  const referencias = [window.location.href, document.referrer];
  try {
    referencias.push(window.parent.location.href);
  } catch {
    // O iframe do mapa e a página do jogo podem estar em origens diferentes.
  }
  return referencias.filter(Boolean);
}

function temConvite() {
  const papeis = Array.isArray(WA.player.tags) ? WA.player.tags : [];
  if (papeis.some((papel) => PAPEIS_AUTORIZADOS.has(String(papel).toLowerCase()))) {
    return "papel";
  }

  const nome = String(WA.player.name || "").trim();
  if (CONVIDADOS.some((convidado) => convidado.toLowerCase() === nome.toLowerCase())) {
    return "lista";
  }

  const convite = `CONVITE=${CODIGO}`;
  if (referenciasDaPagina().some((referencia) => referencia.toUpperCase().includes(convite))) {
    return "convite";
  }

  return null;
}

WA.onInit().then(() => {
  let bloqueando = false;

  const verificarEntrada = (mostrarPermissao = false) => {
    const via = temConvite();
    if (via) {
      if (mostrarPermissao) {
        WA.ui.banner.openBanner({
          id: "porta-ok",
          text: "Diretoria — entrada autorizada.",
          bgColor: "#1e7f5c",
          textColor: "#ffffff",
          closable: true,
          timeToClose: 3000,
        });
      }
      return;
    }

    if (bloqueando) return;
    bloqueando = true;
    WA.ui.banner.openBanner({
      id: "porta-trancada",
      text: "Diretoria — você pode ver, mas a entrada exige convite.",
      bgColor: "#8f2b2b",
      textColor: "#ffffff",
      closable: true,
      timeToClose: 5000,
    });
    WA.player.teleport(VOLTA.x, VOLTA.y);
    setTimeout(() => {
      bloqueando = false;
    }, 1200);
  };

  WA.room.area.onEnter("PortaDiretoria").subscribe(() => verificarEntrada(true));
  WA.room.area.onEnter("Diretoria").subscribe(() => verificarEntrada(false));

  console.log("[porta] Diretoria visível; soleira seletiva ativa.");
});

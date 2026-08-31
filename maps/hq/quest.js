/**
 * E2.2 + E2.3 + E2.4 — Quest do HQ.
 *
 * Toca 3 pontos (Laboratorio, Palco, Cafe) -> conquista + XP + badge.
 * Estado vai em variavel de JOGADOR, conforme decidido no spike E2.1:
 * XP e progresso sao individuais e sobrevivem a sala vazia.
 */

const PONTOS = ["Laboratorio", "Palco", "Cafe"];
const XP_POR_PONTO = 10;

WA.onInit()
  .then(function () {
    console.info("[HQ] quest carregada");

    WA.player.getPosition().then(function (p) {
      console.info("[HQ] posicao inicial x=" + Math.round(p.x) + " y=" + Math.round(p.y));
    });

    var lidos = WA.player.state.hq_visitados;
    var visitados = Array.isArray(lidos) ? lidos : [];
    var xp = Number(WA.player.state.hq_xp) || 0;

    function mostrar(texto) {
      console.info("[HQ] " + texto);
      try {
        WA.ui.banner.openBanner({
          id: "hq-quest",
          text: texto,
          bgColor: "#0f6f4d",
          textColor: "#ffffff",
          closable: true,
        });
      } catch (e) {
        WA.chat.sendChatMessage(texto, "HQ");
      }
    }

    function conferirBadge() {
      if (visitados.length >= PONTOS.length) {
        mostrar("BADGE: Explorador do HQ - " + xp + " XP");
      }
    }

    PONTOS.forEach(function (ponto) {
      WA.room.area.onEnter(ponto).subscribe(function () {
        if (visitados.indexOf(ponto) !== -1) {
          mostrar(ponto + " ja visitado - " + xp + " XP");
          return;
        }
        visitados = visitados.concat([ponto]);
        xp = xp + XP_POR_PONTO;
        WA.player.state.hq_visitados = visitados;
        WA.player.state.hq_xp = xp;

        var faltam = PONTOS.length - visitados.length;
        mostrar(
          faltam > 0
            ? "+" + XP_POR_PONTO + " XP (" + xp + ") - faltam " + faltam
            : "QUEST COMPLETA - " + xp + " XP"
        );
        conferirBadge();
      });
    });

    // E3.4 — NPC de recepcao: conversa por proximidade, com LLM atras do proxy.
    var PROXY = "http://localhost:8899";
    var SAUDACAO = "Oi! Sou o guia do HQ. Pergunte qualquer coisa no chat.";
    var conversas = 0;

    function falar(texto) {
      console.info("[NPC] " + texto);
      WA.ui.banner.openBanner({
        id: "hq-npc",
        text: "Guia do HQ: " + texto,
        bgColor: "#22304a",
        textColor: "#ffffff",
        closable: true,
      });
    }

    function perguntar(pergunta) {
      return fetch(PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pergunta: pergunta }),
      })
        .then(function (r) { return r.json(); })
        .then(function (j) { falar(j.resposta); })
        .catch(function () { falar("O guia esta sem sinal agora."); });
    }

    WA.room.area.onEnter("NPC").subscribe(function () {
      conversas = conversas + 1;
      falar(SAUDACAO);
      perguntar(
        conversas === 1
          ? "Me de as boas-vindas ao HQ em uma frase."
          : "O visitante voltou pela " + conversas + "a vez. Comente isso."
      );
    });

    WA.room.area.onLeave("NPC").subscribe(function () {
      WA.ui.banner.closeBanner();
    });

    // Perguntas livres pelo chat do jogo.
    WA.chat.onChatMessage(function (mensagem) {
      perguntar(mensagem);
    });

    conferirBadge();
  })
  .catch(function (e) {
    console.error("[HQ] erro na quest", e);
  });

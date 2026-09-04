/**
 * Registro de verbos do motor de reacoes.
 *
 * Cada verbo e uma funcao (params, ctx) => Promise|void apoiada em metodo real
 * da API do WorkAdventure. Nenhum verbo inventado: o que a API nao tem (sprite
 * arbitrario, particula, NPC) nao existe aqui — usa-se camada de tile.
 *
 * ctx = { regraId, dados, contadorLocal }
 */

(function (global) {
  "use strict";

  function num(valor, padrao) {
    return typeof valor === "number" && isFinite(valor) ? valor : padrao;
  }

  function hexParaRgb(hex) {
    var limpo = String(hex || "#FFD700").replace("#", "");
    if (limpo.length === 3) {
      limpo = limpo[0] + limpo[0] + limpo[1] + limpo[1] + limpo[2] + limpo[2];
    }
    var n = parseInt(limpo, 16);
    if (isNaN(n)) n = 0xffd700;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  var ACOES = {
    som: function (p) {
      var som = WA.sound.loadSound(p.url);
      return som.play({ volume: num(p.volume, 0.7) });
    },

    banner: function (p, ctx) {
      return WA.ui.banner.openBanner({
        id: "motor-" + ctx.regraId,
        text: String(p.texto || ""),
        bgColor: p.cor || "#8A6D1D",
        textColor: p.corTexto || "#ffffff",
        closable: true,
        timeToClose: num(p.segundos, 8) * 1000,
      });
    },

    mensagem: function (p) {
      return WA.ui.displayActionMessage({
        message: String(p.texto || ""),
        callback: function () {},
      });
    },

    chat: function (p) {
      return WA.chat.sendChatMessage(String(p.texto || ""));
    },

    modal: function (p) {
      return WA.ui.modal.openModal({
        title: String(p.titulo || ""),
        src: p.url,
        position: p.posicao || "right",
        allowApi: false,
      });
    },

    camada: function (p) {
      return p.visivel ? WA.room.showLayer(p.nome) : WA.room.hideLayer(p.nome);
    },

    // Faixas do MESMO grupo de camadas: mostra a da faixa em que o valor cai e
    // esconde as outras. Nao ha operador no catalogo — os cortes sao dados:
    // faixas = [{ate:0,camada:null},{ate:10,camada:"x"},{camada:"y"}] (ultima = resto).
    camada_faixa: function (p) {
      var faixas = Array.isArray(p.faixas) ? p.faixas : [];
      var valor = Number(p.valor);
      if (!isFinite(valor)) valor = 0;
      var escolhida = null;
      for (var i = 0; i < faixas.length; i += 1) {
        var ate = faixas[i].ate;
        if (typeof ate !== "number" || valor <= ate) {
          escolhida = faixas[i].camada || null;
          break;
        }
      }
      console.info(
        "[motor] camada_faixa valor=" + valor + " showLayer " + (escolhida || "nenhuma")
      );
      return Promise.all(
        faixas.map(function (faixa) {
          if (!faixa.camada) return null;
          return faixa.camada === escolhida
            ? WA.room.showLayer(faixa.camada)
            : WA.room.hideLayer(faixa.camada);
        })
      );
    },

    camada_piscar: function (p) {
      var vezes = num(p.vezes, 3);
      var intervalo = num(p.intervalo, 400);
      return new Promise(function (pronto) {
        var i = 0;
        function passo() {
          if (i >= vezes * 2) {
            WA.room.hideLayer(p.nome);
            pronto();
            return;
          }
          if (i % 2 === 0) WA.room.showLayer(p.nome);
          else WA.room.hideLayer(p.nome);
          i += 1;
          setTimeout(passo, intervalo);
        }
        passo();
      });
    },

    tiles: function (p) {
      return WA.room.setTiles(p.lista || []);
    },

    propriedade: function (p) {
      return WA.room.setProperty(p.camada, p.nome, p.valor);
    },

    destaque: function (p) {
      var rgb = hexParaRgb(p.cor);
      var segundos = num(p.segundos, 60);
      var r = WA.player.setOutlineColor(rgb[0], rgb[1], rgb[2]);
      setTimeout(function () {
        try {
          var saida = WA.player.removeOutlineColor();
          if (saida && saida.catch) saida.catch(function () {});
        } catch (erro) {
          /* mundo sem jogador nao e falha de reacao */
        }
      }, segundos * 1000);
      return r;
    },

    contador: function (p, ctx) {
      var chave = p.chave;
      var passo = num(p.passo, 1);
      var minimo = typeof p.minimo === "number" ? p.minimo : null;
      function limitar(valor) {
        return minimo !== null && valor < minimo ? minimo : valor;
      }
      return Promise.resolve()
        .then(function () {
          return WA.state.loadVariable(chave);
        })
        .then(function (atual) {
          var total = limitar((Number(atual) || 0) + passo);
          return Promise.resolve(WA.state.saveVariable(chave, total)).then(function () {
            ctx.dados.total = total;
            return total;
          });
        })
        .catch(function () {
          // Variavel nao declarada no .tmj: cai para contagem local do cliente.
          ctx.contadorLocal[chave] = limitar((ctx.contadorLocal[chave] || 0) + passo);
          ctx.dados.total = ctx.contadorLocal[chave];
          console.info("[motor] contador local " + chave + " = " + ctx.contadorLocal[chave]);
          return ctx.contadorLocal[chave];
        });
    },

    site: function (p) {
      return WA.nav.openCoWebSite(p.url, false, "", num(p.largura, 40), 0, true, true);
    },
  };

  global.ACOES_MOTOR = ACOES;
})(typeof window !== "undefined" ? window : globalThis);

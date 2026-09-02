/**
 * Motor de reacoes do mundo — le reacoes.json e executa.
 *
 * Reacao nova = uma linha de JSON. Este arquivo nao muda.
 * Contrato do catalogo: reacoes.schema.md
 */

(function (global) {
  "use strict";

  var CATALOGO_URL = "http://maps.workadventure.test/hq/reacoes.json";

  // WA.event.on exige nome literal: o curinga "crm-*" e expandido contra esta lista.
  var EVENTOS_CRM = [
    "crm-quiz_view",
    "crm-quiz_start",
    "crm-quiz_step_answered",
    "crm-quiz_complete",
    "crm-resultado_view",
    "crm-resultado_cta_click",
    "crm-matricula_view",
    "crm-onboarding_in_progress",
    "crm-onboarding_completed",
    "crm-pre_task_awaiting_review",
    "crm-first_job_approved",
    "crm-first_job_rejected",
  ];

  var TETO_GLOBAL_POR_MINUTO = 20;
  var TETO_FILA = 30;
  var TETO_REGRA_PADRAO = 12;

  var estado = {
    regras: [],
    disparos: 0,
    descartes: 0,
  };
  global.__motorReacoes = estado;

  var ultimoDisparo = {}; // id -> instante
  var janelaRegra = {}; // id -> array de instantes
  var janelaGlobal = [];
  var contadorLocal = {};
  var fila = [];
  var rodando = false;

  // ---------- interpolacao ----------

  var MARCA = "\u0000";

  // {campo} vira data.campo. {campo|padrao} usa o padrao quando o campo vier
  // ausente, nulo ou vazio — o funil manda actorLabel null quando nao ha PII.
  function interpolar(texto, dados) {
    return String(texto)
      .split("{{")
      .join(MARCA)
      .replace(/\{([^{}]*)\}/g, function (_, expressao) {
        var corte = expressao.indexOf("|");
        var campo = corte === -1 ? expressao : expressao.slice(0, corte);
        var padrao = corte === -1 ? "" : expressao.slice(corte + 1);
        var valor = dados[campo];
        if (valor === undefined || valor === null || valor === "") return padrao;
        return String(valor);
      })
      .split(MARCA)
      .join("{");
  }

  function interpolarParams(params, dados) {
    var saida = {};
    Object.keys(params).forEach(function (chave) {
      var valor = params[chave];
      saida[chave] = typeof valor === "string" ? interpolar(valor, dados) : valor;
    });
    return saida;
  }

  // ---------- catalogo ----------

  function validar(bruto) {
    var vistos = {};
    var validas = [];
    for (var i = 0; i < bruto.length; i += 1) {
      var r = bruto[i];
      if (!r || typeof r.id !== "string" || !r.id) {
        console.error("[motor] regra sem id descartada (indice " + i + ")");
        continue;
      }
      if (vistos[r.id]) {
        console.error("[motor] id repetido: " + r.id);
        return null; // recusa o catalogo INTEIRO
      }
      vistos[r.id] = true;
      if (typeof r.quando !== "string" || !r.quando) {
        console.error("[motor] regra sem quando descartada: " + r.id);
        continue;
      }
      if (!Array.isArray(r.faz) || r.faz.length === 0) {
        console.error("[motor] regra sem faz descartada: " + r.id);
        continue;
      }
      validas.push(r);
    }
    return validas;
  }

  function indexar(regras) {
    var exatas = {};
    var prefixos = [];
    regras.forEach(function (r) {
      if (r.quando.slice(-1) === "*") {
        prefixos.push({ prefixo: r.quando.slice(0, -1), regra: r });
      } else {
        if (!exatas[r.quando]) exatas[r.quando] = [];
        exatas[r.quando].push(r);
      }
    });
    return { exatas: exatas, prefixos: prefixos };
  }

  function nomesParaAssinar(indice) {
    var nomes = {};
    Object.keys(indice.exatas).forEach(function (n) {
      nomes[n] = true;
    });
    indice.prefixos.forEach(function (p) {
      EVENTOS_CRM.forEach(function (n) {
        if (n.indexOf(p.prefixo) === 0) nomes[n] = true;
      });
    });
    return Object.keys(nomes);
  }

  function regrasDoEvento(indice, nome) {
    var lista = (indice.exatas[nome] || []).slice();
    indice.prefixos.forEach(function (p) {
      if (nome.indexOf(p.prefixo) === 0) lista.push(p.regra);
    });
    return lista;
  }

  // ---------- travas ----------

  function podarJanela(lista, agora) {
    while (lista.length && agora - lista[0] > 60000) lista.shift();
    return lista;
  }

  function passaNasTravas(regra, agora) {
    var silencio = typeof regra.silencio === "number" ? regra.silencio : 0;
    if (silencio > 0 && agora - (ultimoDisparo[regra.id] || 0) < silencio) {
      console.info("[motor] silencio " + regra.id);
      return false;
    }
    var teto = typeof regra.teto_por_minuto === "number" ? regra.teto_por_minuto : TETO_REGRA_PADRAO;
    if (!janelaRegra[regra.id]) janelaRegra[regra.id] = [];
    if (podarJanela(janelaRegra[regra.id], agora).length >= teto) {
      console.info("[motor] teto " + regra.id);
      return false;
    }
    if (podarJanela(janelaGlobal, agora).length >= TETO_GLOBAL_POR_MINUTO) {
      console.info("[motor] teto global");
      return false;
    }
    return true;
  }

  // ---------- execucao ----------

  function executarRegra(regra, dados) {
    var ctx = { regraId: regra.id, dados: dados, contadorLocal: contadorLocal };
    var acoes = regra.faz.slice();

    function proxima() {
      if (!acoes.length) return Promise.resolve();
      var passo = acoes.shift();
      var verbo = global.ACOES_MOTOR ? global.ACOES_MOTOR[passo.acao] : null;
      if (!verbo) {
        console.error("[motor] acao desconhecida: " + passo.acao + " (regra " + regra.id + ")");
        return proxima();
      }
      return Promise.resolve()
        .then(function () {
          return verbo(interpolarParams(passo, ctx.dados), ctx);
        })
        .catch(function (erro) {
          console.error("[motor] falha " + passo.acao + " " + regra.id + ": " + (erro && erro.message ? erro.message : erro));
        })
        .then(proxima);
    }

    return proxima();
  }

  function bombear() {
    if (rodando) return;
    var item = fila.shift();
    if (!item) return;
    rodando = true;
    executarRegra(item.regra, item.dados)
      .catch(function () {})
      .then(function () {
        rodando = false;
        bombear();
      });
  }

  function enfileirar(regra, dados) {
    if (fila.length >= TETO_FILA) {
      estado.descartes += 1;
      console.info("[motor] fila cheia, descartado " + regra.id);
      return;
    }
    var agora = Date.now();
    ultimoDisparo[regra.id] = agora;
    janelaRegra[regra.id].push(agora);
    janelaGlobal.push(agora);
    estado.disparos += 1;
    fila.push({ regra: regra, dados: dados });
    bombear();
  }

  function casa(regra, dados) {
    if (!regra.se) return true;
    var chaves = Object.keys(regra.se);
    for (var i = 0; i < chaves.length; i += 1) {
      if (dados[chaves[i]] !== regra.se[chaves[i]]) return false;
    }
    return true;
  }

  // ---------- boot ----------

  function ligar(catalogo) {
    var regras = validar(Array.isArray(catalogo.regras) ? catalogo.regras : []);
    if (regras === null) {
      console.error("[motor] catalogo recusado, nenhuma regra assinada");
      return;
    }
    estado.regras = regras;
    var indice = indexar(regras);

    nomesParaAssinar(indice).forEach(function (nome) {
      WA.event.on(nome).subscribe(function (evento) {
        var dados = (evento && (evento.data || evento.value)) || {};
        var agora = Date.now();
        regrasDoEvento(indice, nome).forEach(function (regra) {
          if (!casa(regra, dados)) return;
          if (!passaNasTravas(regra, agora)) {
            estado.descartes += 1;
            return;
          }
          console.info("[motor] " + regra.id + " <- " + nome);
          enfileirar(regra, JSON.parse(JSON.stringify(dados)));
        });
      });
    });

    console.info("[motor] pronto · " + regras.length + " regras · " + nomesParaAssinar(indice).length + " eventos");
  }

  estado.pronto = WA.onInit()
    .then(function () {
      return fetch(CATALOGO_URL + "?v=" + Date.now());
    })
    .then(function (resposta) {
      if (!resposta.ok) throw new Error("HTTP " + resposta.status);
      return resposta.json();
    })
    .then(ligar)
    .catch(function (erro) {
      console.error("[motor] catalogo invalido: " + (erro && erro.message ? erro.message : erro));
    });
})(typeof window !== "undefined" ? window : globalThis);

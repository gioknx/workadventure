/**
 * Arnes do motor de reacoes, sem navegador.
 *
 *   cd ~/dev/workadventure && node --test maps/hq/motor-reacoes.test.mjs
 *
 * Monta um WA falso num contexto isolado (node:vm), carrega motor-acoes.js e
 * motor-reacoes.js de verdade e prova o comportamento contra o catalogo.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FONTE_ACOES = readFileSync(join(AQUI, "motor-acoes.js"), "utf8");
const FONTE_MOTOR = readFileSync(join(AQUI, "motor-reacoes.js"), "utf8");
const CATALOGO_REAL = JSON.parse(readFileSync(join(AQUI, "reacoes.json"), "utf8"));

function esperar(ms) {
  return new Promise((ok) => setTimeout(ok, ms));
}

/** Sobe um motor isolado com o catalogo dado. */
async function montar(catalogo) {
  const registro = {
    som: [],
    banner: [],
    mensagem: [],
    chat: [],
    outline: [],
    variaveis: {},
    assinados: [],
    logs: [],
  };
  const handlers = new Map();

  const WA = {
    onInit: () => Promise.resolve(),
    sound: {
      loadSound: (url) => ({
        play: (opcoes) => {
          registro.som.push({ url, ...opcoes });
          return Promise.resolve(url);
        },
      }),
    },
    ui: {
      banner: {
        openBanner: (b) => {
          registro.banner.push(b);
          return Promise.resolve();
        },
      },
      modal: { openModal: () => Promise.resolve() },
      displayActionMessage: (m) => {
        registro.mensagem.push(m.message);
        return { remove: () => {} };
      },
    },
    chat: {
      sendChatMessage: (t) => {
        registro.chat.push(t);
      },
    },
    room: {
      showLayer: () => {},
      hideLayer: () => {},
      setTiles: () => {},
      setProperty: () => {},
    },
    player: {
      setOutlineColor: (r, g, b) => {
        registro.outline.push([r, g, b]);
        return Promise.resolve();
      },
      removeOutlineColor: () => Promise.resolve(),
    },
    state: {
      loadVariable: (c) => registro.variaveis[c],
      saveVariable: (c, v) => {
        registro.variaveis[c] = v;
        return Promise.resolve();
      },
    },
    nav: { openCoWebSite: () => Promise.resolve() },
    event: {
      on: (nome) => {
        registro.assinados.push(nome);
        return {
          subscribe: (cb) => {
            handlers.set(nome, cb);
          },
        };
      },
    },
  };

  const anotar = (...a) => registro.logs.push(a.join(" "));
  const contexto = createContext({
    WA,
    fetch: async () => ({ ok: true, json: async () => catalogo }),
    console: { info: anotar, error: anotar, log: anotar },
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    Date,
    Object,
    Array,
    Number,
    String,
    isFinite,
    parseInt,
    isNaN,
  });

  runInContext(FONTE_ACOES, contexto, { filename: "motor-acoes.js" });
  runInContext(FONTE_MOTOR, contexto, { filename: "motor-reacoes.js" });

  const estado = runInContext("__motorReacoes", contexto);
  await estado.pronto;

  return {
    registro,
    estado,
    emitir(nome, data) {
      const cb = handlers.get(nome);
      assert.ok(cb, `evento nao assinado: ${nome}`);
      cb({ data });
    },
    assinou: (nome) => handlers.has(nome),
  };
}

test("venda: 1 som, 1 banner interpolado e contador incrementado", async () => {
  const m = await montar(CATALOGO_REAL);
  m.emitir("crm-matricula_view", {
    actorLabel: "Ana",
    groupLabel: "Squad Alfa",
    severity: "celebrate",
  });
  await esperar(30);

  assert.equal(m.registro.som.length, 1);
  assert.equal(m.registro.som[0].url, "sons/sino.mp3");
  assert.equal(m.registro.som[0].volume, 0.72);
  assert.equal(m.registro.banner.length, 1);
  assert.match(m.registro.banner[0].text, /Ana/);
  assert.match(m.registro.banner[0].text, /Squad Alfa/);
  assert.equal(m.registro.variaveis.hq_vendas_dia, 1);
});

test("rotulo ausente: actorLabel null cai no padrao do catalogo", async () => {
  const m = await montar(CATALOGO_REAL);
  m.emitir("crm-matricula_view", {
    actorLabel: null,
    groupLabel: null,
    severity: "celebrate",
  });
  await esperar(30);

  assert.equal(m.registro.banner.length, 1);
  assert.equal(m.registro.banner[0].text, "🔔 VENDA · Candidata · CRM");
});

test("silencio: segundo disparo em 100 ms e descartado", async () => {
  const m = await montar(CATALOGO_REAL);
  m.emitir("crm-matricula_view", { actorLabel: "Ana", severity: "celebrate" });
  await esperar(20);
  m.emitir("crm-matricula_view", { actorLabel: "Ana", severity: "celebrate" });
  await esperar(30);

  assert.equal(m.registro.som.length, 1, "tocou som dentro da janela de silencio");
  assert.equal(m.estado.descartes, 1);
  assert.ok(m.registro.logs.some((l) => l.includes("silencio venda-sino")));
});

test("alto volume: 30 quiz_step_answered nao produzem som nem banner", async () => {
  const m = await montar(CATALOGO_REAL);
  for (let i = 0; i < 30; i += 1) m.emitir("crm-quiz_step_answered", { severity: "info" });
  await esperar(60);

  assert.equal(m.registro.som.length, 0);
  assert.equal(m.registro.banner.length, 0);
  assert.ok(m.estado.disparos <= 12, `disparos passou do teto da regra: ${m.estado.disparos}`);
  assert.ok(m.estado.descartes > 0);
});

test("teto global corta a soma de regras distintas em 20 por minuto", async () => {
  const m = await montar(CATALOGO_REAL);
  const eventos = [
    "crm-quiz_view",
    "crm-quiz_start",
    "crm-quiz_complete",
    "crm-resultado_view",
  ];
  for (let i = 0; i < 8; i += 1) eventos.forEach((e) => m.emitir(e, { severity: "info" }));
  await esperar(80);

  assert.equal(m.estado.disparos, 20, `teto global nao cortou: ${m.estado.disparos}`);
  assert.equal(m.estado.descartes, 12);
  assert.ok(m.registro.logs.some((l) => l.includes("teto global")));
});

test("acao desconhecida: pula a acao e executa as demais da regra", async () => {
  const m = await montar({
    regras: [
      {
        id: "misto",
        quando: "crm-quiz_view",
        faz: [
          { acao: "inexistente", texto: "nada" },
          { acao: "mensagem", texto: "cheguei · {actorLabel}" },
        ],
      },
    ],
  });
  m.emitir("crm-quiz_view", { actorLabel: "Bia" });
  await esperar(30);

  assert.deepEqual(m.registro.mensagem, ["cheguei · Bia"]);
  assert.ok(m.registro.logs.some((l) => l.includes("acao desconhecida: inexistente")));
});

test("id repetido: recusa o catalogo inteiro e nao assina nada", async () => {
  const m = await montar({
    regras: [
      { id: "a", quando: "crm-quiz_view", faz: [{ acao: "mensagem", texto: "x" }] },
      { id: "a", quando: "crm-quiz_start", faz: [{ acao: "mensagem", texto: "y" }] },
    ],
  });

  assert.equal(m.registro.assinados.length, 0);
  assert.equal(m.estado.regras.length, 0);
  assert.ok(m.registro.logs.some((l) => l.includes("id repetido: a")));
});

test("se: severity info nao casa com regra que exige celebrate", async () => {
  const m = await montar({
    regras: [
      {
        id: "so-celebra",
        quando: "crm-matricula_view",
        se: { severity: "celebrate" },
        faz: [{ acao: "mensagem", texto: "oi" }],
      },
    ],
  });
  m.emitir("crm-matricula_view", { severity: "info" });
  await esperar(30);

  assert.equal(m.estado.disparos, 0);
  assert.equal(m.registro.mensagem.length, 0);
});

test("curinga: crm-* assina os 12 eventos do CRM", async () => {
  const m = await montar({
    regras: [{ id: "tudo", quando: "crm-*", faz: [{ acao: "chat", texto: "{actorLabel}" }] }],
  });

  assert.equal(m.registro.assinados.length, 12);
  m.emitir("crm-first_job_rejected", { actorLabel: "Cris" });
  await esperar(30);
  assert.deepEqual(m.registro.chat, ["Cris"]);
});

test("catalogo real: 12 regras, ids unicos, todo verbo existe", async () => {
  const ctxVerbos = createContext({
    console,
    setTimeout,
    Promise,
    Object,
    Number,
    String,
    isFinite,
    parseInt,
    isNaN,
  });
  runInContext(FONTE_ACOES, ctxVerbos, { filename: "motor-acoes.js" });
  const verbos = Object.keys(runInContext("ACOES_MOTOR", ctxVerbos));

  assert.equal(CATALOGO_REAL.regras.length, 12);
  const ids = CATALOGO_REAL.regras.map((r) => r.id);
  assert.equal(new Set(ids).size, 12);
  CATALOGO_REAL.regras.forEach((r) => {
    r.faz.forEach((a) => {
      assert.ok(verbos.includes(a.acao), `verbo ausente no registro: ${a.acao} (${r.id})`);
    });
  });

  const m = await montar(CATALOGO_REAL);
  assert.equal(m.estado.regras.length, 12);
});

/**
 * Ponte do CRM — consumidor do barramento de eventos.
 *
 * Assina o SSE do barramento neutro, descarta repetido e atrasado, prefixa o
 * nome do evento com "crm-" e injeta pelo pusher (POST /global/event), que
 * entrega a todos os clientes da sala.
 *
 * A ponte NAO decide reacao. Qual evento vira som, banner ou contador mora no
 * catalogo do mundo (maps/hq/reacoes.json), lido por maps/hq/motor-reacoes.js.
 */

import { createServer } from "node:http";
import { createHmac } from "node:crypto";

const PONTE_EVENTOS_URL = process.env.PONTE_EVENTOS_URL || "http://localhost:8902/eventos";
const HQ_PLAY_EVENT_URL = process.env.HQ_PLAY_EVENT_URL || "http://play.workadventure.test/global/event";
const TOKEN_ADMIN = process.env.ADMIN_API_TOKEN || "123";
const PORTA_SAUDE = Number(process.env.PONTE_SAUDE_PORT || 8903);

// Elo do ledger: venda que atravessa a ponte tambem credita pontos no
// admin-api, com o MESMO event_id da outbox — a idempotencia do CRM vira a
// idempotencia do ledger. Sem URL ou sem segredo o elo fica desligado, e a
// ponte volta a ser so injetora (e o que o teste ponta a ponta exercita).
const HQ_ADMIN_VENDA_URL = process.env.HQ_ADMIN_VENDA_URL || "";
const HQ_WEBHOOK_SECRET = process.env.HQ_WEBHOOK_SECRET || "";

const JANELA_MS = 5 * 60 * 1000; // idade maxima do evento
const VIDA_CHAVE_MS = 10 * 60 * 1000; // quanto tempo a chave fica na memoria
const LIMITE_CHAVES = 500;
const VARREDURA_MS = 60 * 1000;
const RECUO_MINIMO_MS = 1000;
const RECUO_MAXIMO_MS = 30000;

const EVENTOS = new Set([
  "quiz_view",
  "quiz_start",
  "quiz_step_answered",
  "quiz_complete",
  "resultado_view",
  "resultado_cta_click",
  "matricula_view",
  "onboarding_in_progress",
  "onboarding_completed",
  "pre_task_awaiting_review",
  "first_job_approved",
  "first_job_rejected",
]);

// Estagio do negocio no funil. Substituiu a antiga `severity` (info/celebrate),
// que era reacao vazando para o contrato do dado.
const ESTAGIOS = new Set(["lead", "qualified", "onboarding", "conversion", "retained", "lost"]);

// Vocabulario unico: todo evento vira "crm-<event>", com o kit de venda inteiro.
// Qual deles vira som, banner ou contador e decisao do catalogo do mundo.
const PARA_O_MUNDO = (e) => ({ name: "crm-" + e.event, data: {
  actorLabel: e.payload.actorLabel,
  groupLabel: e.payload.groupLabel,
  ownerLabel: e.payload.ownerLabel,
  dealId: e.payload.dealId,
  amount: e.payload.amount,
  currency: e.payload.currency,
  productLabel: e.payload.productLabel,
  stage: e.payload.stage,
  occurredAt: e.occurredAt } });

const metricas = {
  conectado: false,
  recebidos: 0,
  injetados: 0,
  descartados_duplicados: 0,
  descartados_atrasados: 0,
  vendas_creditadas: 0,
  vendas_duplicadas: 0,
  vendas_falhas: 0,
};

const vistas = new Map(); // idempotencyKey -> instante em que entrou
const fila = []; // FIFO das chaves, para o teto de LIMITE_CHAVES
let ultimaChave = null;

function registrarChave(chave) {
  vistas.set(chave, Date.now());
  fila.push(chave);
  while (fila.length > LIMITE_CHAVES) {
    const antiga = fila.shift();
    vistas.delete(antiga);
  }
}

function varrerChaves() {
  const limite = Date.now() - VIDA_CHAVE_MS;
  for (const [chave, instante] of vistas) {
    if (instante < limite) vistas.delete(chave);
  }
  while (fila.length && !vistas.has(fila[0])) fila.shift();
}

function rotuloNulo(valor) {
  return valor === null || typeof valor === "string";
}

function envelopeValido(evento) {
  if (!evento || typeof evento !== "object" || Array.isArray(evento)) return false;
  const topo = Object.keys(evento);
  if (topo.length !== 4) return false;
  for (const chave of ["event", "idempotencyKey", "occurredAt", "payload"]) {
    if (!topo.includes(chave)) return false;
  }
  if (!EVENTOS.has(evento.event)) return false;
  if (typeof evento.idempotencyKey !== "string" || !evento.idempotencyKey.trim()) return false;
  if (typeof evento.occurredAt !== "string" || !Number.isFinite(Date.parse(evento.occurredAt))) return false;
  const payload = evento.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const chavesPayload = Object.keys(payload);
  const ESPERADAS = ["actorLabel", "groupLabel", "ownerLabel", "dealId",
    "amount", "currency", "productLabel", "stage"];
  if (chavesPayload.length !== ESPERADAS.length) return false;
  for (const chave of ESPERADAS) {
    if (!chavesPayload.includes(chave)) return false;
  }
  if (!rotuloNulo(payload.actorLabel) || !rotuloNulo(payload.groupLabel)) return false;
  if (!rotuloNulo(payload.ownerLabel) || !rotuloNulo(payload.productLabel)) return false;
  if (!rotuloNulo(payload.dealId) || !rotuloNulo(payload.currency)) return false;
  if (payload.amount !== null && typeof payload.amount !== "number") return false;
  if (!ESTAGIOS.has(payload.stage)) return false;
  return true;
}

// Sem retry: a idempotencia ja foi consumida quando o evento chegou aqui, e
// reenviar depois de falha do pusher tocaria o sino fora de hora.
async function injetar(pacote) {
  try {
    const resposta = await fetch(HQ_PLAY_EVENT_URL, {
      method: "POST",
      headers: {
        Authorization: TOKEN_ADMIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pacote),
    });
    if (!resposta.ok) {
      console.error(`[crm-ponte] pusher respondeu ${resposta.status} para ${pacote.name}`);
      return;
    }
    metricas.injetados += 1;
    console.log(`[crm-ponte] injetado ${pacote.name}`);
  } catch (erro) {
    console.error(`[crm-ponte] falha ao injetar ${pacote.name}: ${erro.message || erro}`);
  }
}

// Venda -> ledger do admin-api. O `event_id` e a MESMA chave de idempotencia da
// outbox do CRM, entao reenvio da mesma venda cai no `duplicado` do admin-api e
// o ledger nao ganha linha nova. Sem retry, pela mesma razao do `injetar`.
async function creditarVenda(evento) {
  if (!HQ_ADMIN_VENDA_URL || !HQ_WEBHOOK_SECRET) return;
  if (evento.payload.stage !== "conversion") return;
  if (typeof evento.payload.ownerLabel !== "string" || !evento.payload.ownerLabel.trim()) {
    console.log(`[crm-ponte] venda sem ownerLabel, ledger nao creditado ${evento.idempotencyKey}`);
    return;
  }
  const corpo = JSON.stringify({
    event_id: evento.idempotencyKey,
    order_id: evento.payload.dealId || evento.idempotencyKey,
    ativador: evento.payload.ownerLabel,
    timestamp: evento.occurredAt,
  });
  const assinatura =
    "sha256=" + createHmac("sha256", HQ_WEBHOOK_SECRET).update(corpo).digest("hex");
  try {
    const resposta = await fetch(HQ_ADMIN_VENDA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-assinatura": assinatura },
      body: corpo,
    });
    const dados = await resposta.json().catch(() => ({}));
    if (resposta.status === 201) {
      metricas.vendas_creditadas += 1;
      console.log(`[crm-ponte] ledger creditado ${evento.idempotencyKey} sino=${dados.sino}`);
      return;
    }
    if (resposta.status === 200 && dados.status === "duplicado") {
      metricas.vendas_duplicadas += 1;
      console.log(`[crm-ponte] ledger duplicado ${evento.idempotencyKey}`);
      return;
    }
    metricas.vendas_falhas += 1;
    console.error(
      `[crm-ponte] ledger recusou ${evento.idempotencyKey}: ${resposta.status} ${JSON.stringify(dados)}`,
    );
  } catch (erro) {
    metricas.vendas_falhas += 1;
    console.error(`[crm-ponte] falha ao creditar ${evento.idempotencyKey}: ${erro.message || erro}`);
  }
}

async function processar(evento) {
  metricas.recebidos += 1;

  if (!envelopeValido(evento)) {
    console.error(`[crm-ponte] envelope invalido ${JSON.stringify(evento).slice(0, 200)}`);
    return;
  }

  const chave = evento.idempotencyKey;
  if (vistas.has(chave)) {
    metricas.descartados_duplicados += 1;
    console.log(`[crm-ponte] duplicado ${evento.event} ${chave.slice(0, 8)}`);
    return;
  }
  registrarChave(chave);
  ultimaChave = chave;

  const idade = Math.abs(Date.now() - Date.parse(evento.occurredAt));
  if (idade > JANELA_MS) {
    metricas.descartados_atrasados += 1;
    console.log(`[crm-ponte] atrasado ${evento.event} ${chave.slice(0, 8)} ${Math.round(idade / 1000)}s`);
    return;
  }

  await injetar(PARA_O_MUNDO(evento));
  await creditarVenda(evento);
}

function blocoParaEvento(bloco) {
  const dados = [];
  let id = null;
  for (const linha of bloco.split("\n")) {
    if (linha.startsWith(":")) continue;
    const separador = linha.indexOf(":");
    const campo = separador === -1 ? linha : linha.slice(0, separador);
    let valor = separador === -1 ? "" : linha.slice(separador + 1);
    if (valor.startsWith(" ")) valor = valor.slice(1);
    if (campo === "data") dados.push(valor);
    else if (campo === "id") id = valor;
  }
  if (!dados.length) return null;
  try {
    return { id, evento: JSON.parse(dados.join("\n")) };
  } catch (erro) {
    console.error(`[crm-ponte] data ilegivel: ${erro.message || erro}`);
    return null;
  }
}

async function assinar() {
  const cabecalhos = { Accept: "text/event-stream" };
  if (ultimaChave) cabecalhos["Last-Event-ID"] = ultimaChave;

  const resposta = await fetch(PONTE_EVENTOS_URL, { headers: cabecalhos });
  if (!resposta.ok || !resposta.body) throw new Error(`barramento respondeu ${resposta.status}`);

  metricas.conectado = true;
  console.log(`[crm-ponte] assinado ${PONTE_EVENTOS_URL}`);

  const decodificador = new TextDecoder();
  let resto = "";
  for await (const pedaco of resposta.body) {
    resto += decodificador.decode(pedaco, { stream: true });
    let corte;
    while ((corte = resto.indexOf("\n\n")) !== -1) {
      const bloco = resto.slice(0, corte);
      resto = resto.slice(corte + 2);
      const lido = blocoParaEvento(bloco);
      if (lido) await processar(lido.evento);
    }
  }
  throw new Error("stream encerrado pelo barramento");
}

async function laco() {
  let recuo = RECUO_MINIMO_MS;
  for (;;) {
    try {
      await assinar();
      recuo = RECUO_MINIMO_MS;
    } catch (erro) {
      console.error(`[crm-ponte] desconectado: ${erro.message || erro}`);
    }
    metricas.conectado = false;
    await new Promise((resolve) => setTimeout(resolve, recuo));
    recuo = Math.min(recuo * 2, RECUO_MAXIMO_MS);
  }
}

const servidor = createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.writeHead(405).end();
  const url = new URL(req.url, `http://127.0.0.1:${PORTA_SAUDE}`);
  if (url.pathname !== "/saude") return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(metricas));
});

servidor.listen(PORTA_SAUDE, "127.0.0.1", () => {
  console.log(`[crm-ponte] saude em http://127.0.0.1:${PORTA_SAUDE}/saude`);
});

setInterval(varrerChaves, VARREDURA_MS).unref();

laco();

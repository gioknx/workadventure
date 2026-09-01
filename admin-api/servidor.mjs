// Painel de administracao minimo — o "backoffice" que o WorkAdventure pergunta.
//
// O jogo chama este servidor para saber: quem pode entrar, qual o papel,
// qual mapa carregar. Sem ele, o mundo e' aberto a qualquer um.
//
// A lista de convidados vive em convidados.json — texto puro, editavel na mao.
//
// Uso:  node admin-api/servidor.mjs
// Porta 8901.

import { createServer } from "node:http";
import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.ADMIN_API_PORT ?? 8901);
const DADOS = join(AQUI, "dados");
const CAMINHO_LEDGER = join(DADOS, "ledger.jsonl");
const CAMINHO_ORFAS = join(DADOS, "vendas-orfas.jsonl");
const SEGREDO_WEBHOOK = process.env.HQ_WEBHOOK_SECRET ?? "";
const URL_EVENTO_GLOBAL =
  process.env.HQ_PLAY_EVENT_URL ?? "http://play.workadventure.test/global/event";
const TOKEN_ADMIN = process.env.ADMIN_API_TOKEN ?? "123";

function lerDadosJson(nome) {
  const caminho = join(DADOS, nome);
  try {
    return JSON.parse(readFileSync(caminho, "utf8"));
  } catch (erro) {
    console.error(`${nome} ilegivel:`, erro.message);
    throw new Error(`arquivo de dados ilegivel: ${nome}`);
  }
}

function convidados() {
  // relido a cada chamada: editar o arquivo vale na hora, sem reiniciar
  try {
    return JSON.parse(readFileSync(join(AQUI, "convidados.json"), "utf8"));
  } catch (e) {
    console.error("convidados.json ilegivel:", e.message);
    return { aberto: true, pessoas: [] };
  }
}

function achar(lista, email) {
  if (!email) return null;
  return lista.pessoas.find(p => p.email.toLowerCase() === email.toLowerCase()) ?? null;
}

function acharPessoaDados(pessoas, identificador) {
  if (!identificador) return null;
  const valor = String(identificador).trim();
  const candidatos = [valor, valor.split("@")[0]].map((item) => item.toLowerCase());
  for (const [nome, pessoa] of Object.entries(pessoas)) {
    if (candidatos.includes(nome.toLowerCase()) || pessoa.uuid?.toLowerCase() === valor.toLowerCase()) {
      return { nome, pessoa };
    }
  }
}

async function lerCorpoBruto(req) {
  const partes = [];
  let tamanho = 0;
  for await (const parte of req) {
    const buffer = Buffer.from(parte);
    tamanho += buffer.length;
    if (tamanho > 1_000_000) throw new Error("corpo excede 1 MB");
    partes.push(buffer);
  }
  return Buffer.concat(partes);
}

async function lerCorpoJson(req) {
  const corpo = await lerCorpoBruto(req);
  return corpo.length ? JSON.parse(corpo.toString("utf8")) : {};
}

function gravarDadosJson(nome, dados) {
  const destino = join(DADOS, nome);
  const temporario = `${destino}.tmp`;
  writeFileSync(temporario, `${JSON.stringify(dados, null, 2)}\n`);
  renameSync(temporario, destino);
}

function assinaturaValida(corpoBruto, assinatura) {
  if (!SEGREDO_WEBHOOK || !assinatura) return false;
  const valor = String(assinatura).replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(valor)) return false;
  const esperada = createHmac("sha256", SEGREDO_WEBHOOK).update(corpoBruto).digest();
  return timingSafeEqual(esperada, Buffer.from(valor, "hex"));
}

function semanaISO(timestamp) {
  const data = new Date(timestamp);
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "America/Sao_Paulo",
      year: "numeric",
    })
      .formatToParts(data)
      .filter((parte) => parte.type !== "literal")
      .map((parte) => [parte.type, parte.value]),
  );
  const diaLocal = new Date(Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day)));
  const diaSemana = diaLocal.getUTCDay() || 7;
  diaLocal.setUTCDate(diaLocal.getUTCDate() + 4 - diaSemana);
  const anoISO = diaLocal.getUTCFullYear();
  const inicioAno = new Date(Date.UTC(anoISO, 0, 1));
  const numero = Math.ceil(((diaLocal - inicioAno) / 86_400_000 + 1) / 7);
  return `${anoISO}-W${String(numero).padStart(2, "0")}`;
}

function carregarLedger() {
  const texto = readFileSync(CAMINHO_LEDGER, "utf8");
  if (!texto.trim()) return [];
  return texto
    .split("\n")
    .filter(Boolean)
    .map((linha, indice) => {
      try {
        return JSON.parse(linha);
      } catch (erro) {
        throw new Error(`ledger.jsonl ilegivel na linha ${indice + 1}: ${erro.message}`);
      }
    });
}

const ledger = carregarLedger();
let estadoPontos = { saldos: {}, semanas: {} };
const eventosVenda = new Set();
const eventosEstornados = new Set();

function aplicarLancamento(lancamento) {
  estadoPontos.saldos[lancamento.sujeito] =
    (estadoPontos.saldos[lancamento.sujeito] ?? 0) + lancamento.delta;
  const semana = (estadoPontos.semanas[lancamento.semana] ??= { saldos: {} });
  semana.saldos[lancamento.sujeito] = (semana.saldos[lancamento.sujeito] ?? 0) + lancamento.delta;
  if (lancamento.tipo === "credito" && lancamento.motivo === "venda") {
    eventosVenda.add(lancamento.event_id);
  }
  if (lancamento.tipo === "estorno" && lancamento.event_id_original) {
    eventosEstornados.add(lancamento.event_id_original);
  }
}

function reconstruirEstadoPontos() {
  estadoPontos = { saldos: {}, semanas: {} };
  eventosVenda.clear();
  eventosEstornados.clear();
  for (const lancamento of ledger) aplicarLancamento(lancamento);
  gravarDadosJson("estado-pontos.json", estadoPontos);
}

function registrarLancamentos(lancamentos) {
  appendFileSync(CAMINHO_LEDGER, lancamentos.map((item) => `${JSON.stringify(item)}\n`).join(""));
  for (const lancamento of lancamentos) {
    ledger.push(lancamento);
    aplicarLancamento(lancamento);
  }
  gravarDadosJson("estado-pontos.json", estadoPontos);
}

async function dispararSinoGlobal(nome, squadId) {
  const squad = lerDadosJson("squads.json")[squadId];
  if (!squad) throw new Error(`squad desconhecida: ${squadId}`);
  const resposta = await fetch(URL_EVENTO_GLOBAL, {
    method: "POST",
    headers: {
      Authorization: TOKEN_ADMIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "hq-venda",
      data: {
        ativador_nome: nome,
        squad: squadId,
        squad_cor: squad.cor,
      },
    }),
  });
  if (!resposta.ok) {
    throw new Error(`evento global respondeu ${resposta.status}: ${await resposta.text()}`);
  }
}

reconstruirEstadoPontos();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORTA}`);
  const lista = convidados();
  const responder = (codigo, corpo) => {
    res.writeHead(codigo, {
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Assinatura",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify(corpo));
    console.log(`${codigo} ${url.pathname}${url.search}`);
  };

  if (req.method === "OPTIONS") return responder(204, {});

  if (req.method === "POST" && url.pathname === "/webhook/venda") {
    let corpoBruto;
    try {
      corpoBruto = await lerCorpoBruto(req);
    } catch (erro) {
      console.error("[webhook/venda] corpo_invalido:", erro.message);
      return responder(400, { erro: erro.message });
    }
    if (!assinaturaValida(corpoBruto, req.headers["x-assinatura"])) {
      console.error("[webhook/venda] assinatura_invalida");
      return responder(401, { erro: "assinatura invalida" });
    }

    let venda;
    try {
      venda = JSON.parse(corpoBruto.toString("utf8"));
    } catch (erro) {
      console.error("[webhook/venda] json_invalido:", erro.message);
      return responder(400, { erro: "json invalido" });
    }

    const instante = Date.parse(venda.timestamp);
    if (!Number.isFinite(instante) || Math.abs(Date.now() - instante) > 5 * 60 * 1000) {
      console.error("[webhook/venda] timestamp_fora_da_janela");
      return responder(401, { erro: "timestamp fora da janela de 5 minutos" });
    }
    const camposValidos = ["event_id", "order_id", "ativador"].every(
      (campo) => typeof venda[campo] === "string" && venda[campo].trim(),
    );
    if (!camposValidos || typeof venda.timestamp !== "string") {
      console.error("[webhook/venda] schema_incompleto");
      return responder(400, { erro: "schema incompleto" });
    }
    if (eventosVenda.has(venda.event_id)) {
      console.log(`[webhook/venda] duplicado ${venda.event_id}`);
      return responder(200, { status: "duplicado" });
    }

    let cadastro;
    try {
      cadastro = acharPessoaDados(lerDadosJson("pessoas.json"), venda.ativador);
    } catch (erro) {
      return responder(500, { erro: erro.message });
    }
    if (!cadastro?.pessoa?.squad) {
      appendFileSync(
        CAMINHO_ORFAS,
        `${JSON.stringify({ ...venda, recebido_em: new Date().toISOString() })}\n`,
      );
      console.error(`[webhook/venda] pendente_identidade ${venda.event_id}`);
      return responder(202, { status: "pendente_identidade" });
    }

    try {
      const config = lerDadosJson("config-pontos.json");
      const semana = semanaISO(venda.timestamp);
      const lancamentos = [
        {
          entry_id: randomUUID(),
          event_id: venda.event_id,
          tipo: "credito",
          sujeito: `pessoa:${cadastro.pessoa.uuid}`,
          delta: config.pontos_ativador,
          motivo: "venda",
          semana,
          ts: venda.timestamp,
        },
        {
          entry_id: randomUUID(),
          event_id: venda.event_id,
          tipo: "credito",
          sujeito: `squad:${cadastro.pessoa.squad}`,
          delta: config.pontos_squad,
          motivo: "venda",
          semana,
          ts: venda.timestamp,
        },
      ];
      if (lancamentos.some((item) => !Number.isFinite(item.delta))) {
        throw new Error("config-pontos.json contem valor invalido");
      }
      registrarLancamentos(lancamentos);
      let sino = "disparado";
      try {
        await dispararSinoGlobal(cadastro.nome, cadastro.pessoa.squad);
      } catch (erro) {
        sino = "falhou";
        console.error(`[webhook/venda] sino_falhou ${venda.event_id}:`, erro.message);
      }
      console.log(`[webhook/venda] aceita ${venda.event_id}`);
      return responder(201, { status: "aceita", event_id: venda.event_id, sino });
    } catch (erro) {
      console.error("[webhook/venda] falha_persistencia:", erro.message);
      return responder(500, { erro: erro.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/webhook/estorno") {
    let corpoBruto;
    try {
      corpoBruto = await lerCorpoBruto(req);
    } catch (erro) {
      return responder(400, { erro: erro.message });
    }
    if (!assinaturaValida(corpoBruto, req.headers["x-assinatura"])) {
      console.error("[webhook/estorno] assinatura_invalida");
      return responder(401, { erro: "assinatura invalida" });
    }

    let estorno;
    try {
      estorno = JSON.parse(corpoBruto.toString("utf8"));
    } catch {
      return responder(400, { erro: "json invalido" });
    }
    if (typeof estorno.event_id_original !== "string" || !estorno.event_id_original.trim()) {
      return responder(400, { erro: "schema incompleto" });
    }
    if (eventosEstornados.has(estorno.event_id_original)) {
      return responder(200, { status: "duplicado" });
    }

    const originais = ledger.filter(
      (item) =>
        item.event_id === estorno.event_id_original &&
        item.tipo === "credito" &&
        item.motivo === "venda",
    );
    if (!originais.length) return responder(404, { erro: "venda original nao encontrada" });

    try {
      const agora = new Date().toISOString();
      const lancamentos = originais.map((original) => ({
        entry_id: randomUUID(),
        event_id: `estorno:${estorno.event_id_original}`,
        event_id_original: estorno.event_id_original,
        tipo: "estorno",
        sujeito: original.sujeito,
        delta: -original.delta,
        motivo: "estorno",
        semana: original.semana,
        ts: agora,
        reversal_of: original.entry_id,
      }));
      registrarLancamentos(lancamentos);
      console.log(`[webhook/estorno] aceito ${estorno.event_id_original}`);
      return responder(201, { status: "estornado", event_id_original: estorno.event_id_original });
    } catch (erro) {
      console.error("[webhook/estorno] falha_persistencia:", erro.message);
      return responder(500, { erro: erro.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/diretoria/modo") {
    try {
      return responder(200, lerDadosJson("config-diretoria.json"));
    } catch (erro) {
      return responder(500, { erro: erro.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/diretoria/modo") {
    try {
      const atual = lerDadosJson("config-diretoria.json");
      const pedido = await lerCorpoJson(req);
      const modo = pedido.modo ?? (atual.modo === "fechada" ? "aberta" : "fechada");
      if (!["aberta", "fechada"].includes(modo)) {
        return responder(400, { erro: "modo deve ser aberta ou fechada" });
      }
      const proximo = { modo };
      gravarDadosJson("config-diretoria.json", proximo);
      return responder(200, proximo);
    } catch (erro) {
      return responder(400, { erro: erro.message });
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/pessoas/")) {
    try {
      const nome = decodeURIComponent(url.pathname.slice("/pessoas/".length));
      const pessoa = lerDadosJson("pessoas.json")[nome];
      if (!pessoa) return responder(404, { erro: "pessoa nao encontrada" });
      return responder(200, {
        uuid: pessoa.uuid,
        squad: pessoa.squad,
        tags: pessoa.tags ?? [],
      });
    } catch (erro) {
      return responder(500, { erro: erro.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/squads") {
    try {
      const squads = lerDadosJson("squads.json");
      const pessoas = Object.values(lerDadosJson("pessoas.json"));
      return responder(
        200,
        Object.fromEntries(
          Object.entries(squads).map(([id, squad]) => [
            id,
            {
              ...squad,
              membros: pessoas.filter((pessoa) => pessoa.squad === id).length,
            },
          ]),
        ),
      );
    } catch (erro) {
      return responder(500, { erro: erro.message });
    }
  }

  // O jogo pergunta primeiro: que versao de API voce fala?
  if (url.pathname === "/api/capabilities") {
    return responder(200, { "api/woka/list": "v1", "api/companion/list": "v1" });
  }

  // Aparencia dos avatares e companheiros: devolve o padrao do proprio jogo.
  if (url.pathname === "/api/woka/list") return responder(200, {});
  if (url.pathname === "/api/companion/list") return responder(200, []);

  // Dados do mapa pedido
  if (url.pathname === "/api/map") {
    const playUri = url.searchParams.get("playUri") ?? "";
    const caminho = playUri.replace(/^https?:\/\/[^/]+\/_\/[^/]+\//, "");
    const resposta = {
      mapUrl: `http://${caminho}`,
      policy_type: lista.aberto ? 1 : 2,
      tags: [],
      group: null,
      authenticationMandatory: false,
      canReport: true,
      showPoweredBy: true,
      enableChat: true,
      enableChatUpload: true,
      enableChatOnlineList: true,
      enableChatDisconnectedList: true,
    };
    // Campos opcionais so entram quando tem valor: o jogo recusa nulo.
    return responder(200, resposta);
  }

  // O jogo pergunta: essa identidade pode entrar nesta sala?
  if (url.pathname === "/api/room/access") {
    const identificador = url.searchParams.get("userIdentifier");
    let cadastro = null;
    try {
      cadastro = acharPessoaDados(lerDadosJson("pessoas.json"), identificador);
      const sala = url.searchParams.get("roomId") ?? url.searchParams.get("playUri") ?? "";
      const diretoriaFechada = /diretoria-fechada\.tmj(?:$|[?#])/.test(sala);
      const modoDiretoria = diretoriaFechada ? lerDadosJson("config-diretoria.json").modo : null;
      const autorizadoDiretoria =
        modoDiretoria === "aberta" || cadastro?.pessoa?.tags?.includes("diretoria");
      if (diretoriaFechada && !autorizadoDiretoria) {
        return responder(200, {
          status: "error",
          type: "error",
          code: "DIRETORIA_FECHADA",
          title: "Diretoria fechada",
          subtitle: "Sua identidade nao tem autorizacao para esta sala.",
          details: "A permissao e conferida pelo servidor.",
          image: "",
        });
      }
    } catch (erro) {
      return responder(500, { erro: erro.message });
    }

    const convidado = achar(lista, identificador);
    if (!lista.aberto && !convidado) {
      return responder(200, {
        status: "error",
        type: "error",
        code: "NAO_CONVIDADO",
        title: "Mundo fechado",
        subtitle: "Seu e-mail nao esta na lista de convidados.",
        details: "Fale com o dono do HQ para entrar.",
        image: "",
      });
    }
    if (convidado?.banido) {
      return responder(200, {
        status: "error",
        type: "error",
        code: "BANIDO",
        title: "Acesso removido",
        subtitle: "Voce foi banido deste mundo.",
        details: convidado.motivo ?? "",
        image: "",
      });
    }

    const tags = cadastro?.pessoa?.tags ?? convidado?.papeis ?? [];
    const corpo = {
      status: "ok",
      email: identificador ?? null,
      userUuid: cadastro?.pessoa?.uuid ?? identificador ?? "anonimo",
      tags,
      visitCardUrl: null,
      isCharacterTexturesValid: true,
      characterTextures: [],
      isCompanionTextureValid: true,
      companionTexture: null,
      messages: [],
      activatedInviteUser: true,
      canEdit: tags.includes("admin"),
      world: "hq",
    };
    if (cadastro) corpo.username = cadastro.nome;
    else if (convidado) corpo.username = convidado.email.split("@")[0];
    return responder(200, corpo);
  }

  // Quem esta na lista, para o painel humano
  if (url.pathname === "/api/lista") {
    return responder(200, {
      aberto: lista.aberto,
      total: lista.pessoas.length,
      banidos: lista.pessoas.filter(p => p.banido).length,
      pessoas: lista.pessoas,
    });
  }

  responder(404, {
    erro: "rota desconhecida",
    rotas: [
      "/pessoas/:nome",
      "/squads",
      "/diretoria/modo",
      "/webhook/venda",
      "/webhook/estorno",
      "/api/room/access",
      "/api/lista",
    ],
  });
});

server.listen(PORTA, () => {
  const l = convidados();
  console.log(`painel no ar em http://localhost:${PORTA}`);
  console.log(`mundo ${l.aberto ? "ABERTO" : "FECHADO"} · ${l.pessoas.length} na lista`);
});

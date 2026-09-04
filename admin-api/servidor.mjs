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
const CAMINHO_INVASOES_VIP = join(DADOS, "invasoes-vip.jsonl");
const CAMINHO_WOKA_BASE = join(AQUI, "../play/src/pusher/data/woka.json");
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

// Identidade forte e' o uuid do jogador; o nome so serve para exibir e para o
// primeiro vinculo. Quem manda um uuid ja conhecido vence o nome enviado.
function resolverPessoa(pessoas, { uuid, nome }) {
  if (uuid) {
    const alvo = String(uuid).trim().toLowerCase();
    for (const [chave, pessoa] of Object.entries(pessoas)) {
      if (pessoa.uuid && String(pessoa.uuid).toLowerCase() === alvo) {
        return { nome: chave, pessoa };
      }
    }
  }
  return acharPessoaDados(pessoas, nome) ?? null;
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

// Membros creditaveis de um squad, em ordem estavel (ordem de pessoas.json).
// Quem esta no squad mas ainda nao vinculou uuid nao entra: o saldo da loja e'
// indexado por `pessoa:<uuid>`, entao sem uuid nao ha onde creditar.
function membrosDoSquad(pessoas, squadId) {
  return Object.entries(pessoas)
    .filter(([, pessoa]) => pessoa.squad === squadId && pessoa.uuid)
    .map(([nome, pessoa]) => ({ nome, uuid: String(pessoa.uuid) }));
}

// Reparte um total inteiro entre n partes sem criar nem perder ponto: cada um
// leva o piso e o resto vai de 1 em 1 aos primeiros da ordem estavel.
// Invariante: soma(repartirPontos(total, n)) === total.
function repartirPontos(total, n) {
  if (!Number.isInteger(total) || !Number.isInteger(n) || n <= 0) {
    throw new Error("reparticao exige total inteiro e n positivo");
  }
  const piso = Math.trunc(total / n);
  const resto = total - piso * n;
  return Array.from({ length: n }, (_, indice) => piso + (indice < resto ? 1 : 0));
}

function montarPlacar(saldos, semana = null) {
  const squads = lerDadosJson("squads.json");
  const pessoas = lerDadosJson("pessoas.json");
  const linhasSquads = Object.entries(squads)
    .map(([id, squad]) => ({
      id,
      nome: squad.nome,
      cor: squad.cor,
      pontos: saldos[`squad:${id}`] ?? 0,
    }))
    .sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome, "pt-BR"));
  const linhasPessoas = Object.entries(pessoas)
    .map(([nome, pessoa]) => ({
      nome,
      uuid: pessoa.uuid,
      squad: pessoa.squad,
      pontos: saldos[`pessoa:${pessoa.uuid}`] ?? 0,
    }))
    .sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome, "pt-BR"))
    .slice(0, 5);
  return {
    semana,
    squads: linhasSquads,
    pessoas: linhasPessoas,
    vip: lerDadosJson("vip.json"),
  };
}

function inicioSemanaISO(semana) {
  const match = /^(\d{4})-W(\d{2})$/.exec(semana);
  if (!match) throw new Error(`semana ISO invalida: ${semana}`);
  const ano = Number(match[1]);
  const numero = Number(match[2]);
  const quatroJaneiro = new Date(Date.UTC(ano, 0, 4));
  const segundaDaSemanaUm = new Date(quatroJaneiro);
  segundaDaSemanaUm.setUTCDate(
    quatroJaneiro.getUTCDate() - ((quatroJaneiro.getUTCDay() + 6) % 7) + (numero - 1) * 7,
  );
  return segundaDaSemanaUm.getTime();
}

function fecharSemana(semana, forcar = false) {
  const vipAtual = lerDadosJson("vip.json");
  if (
    !forcar &&
    vipAtual.semana &&
    inicioSemanaISO(vipAtual.semana) >= inicioSemanaISO(semana)
  ) {
    return vipAtual;
  }
  const squads = lerDadosJson("squads.json");
  const saldos = estadoPontos.semanas[semana]?.saldos ?? {};
  const resultados = Object.keys(squads).map((id) => ({
    id,
    pontos: saldos[`squad:${id}`] ?? 0,
  }));
  const maior = Math.max(...resultados.map((item) => item.pontos));
  const lideres = maior > 0 ? resultados.filter((item) => item.pontos === maior) : [];
  const vencedor =
    lideres.length === 1 ? lideres[0].id : vipAtual.squad_vencedor;
  const mudou = vencedor && vencedor !== vipAtual.squad_vencedor;
  const proximo = {
    semana,
    squad_vencedor: vencedor ?? null,
    desde: mudou ? new Date().toISOString() : vipAtual.desde,
  };
  gravarDadosJson("vip.json", proximo);
  console.log(
    `[vip] semana ${semana} fechada · vencedor ${proximo.squad_vencedor ?? "mantido vazio"}`,
  );
  return proximo;
}

// Pecas abertas da casa: aparecem para todo mundo, sem resgate por pontos.
// Cada peca declara a camada do Woka em que entra (ordem em PlayerTextures.ts).
const PECAS_HQ = [
  {
    parte: "hat",
    id: "hq-boina",
    name: "Boina HQ",
    url: "http://maps.workadventure.test/hq/wokas/hq-boina.png",
  },
  {
    parte: "clothes",
    id: "hq-camiseta",
    name: "Camiseta HQ",
    url: "http://maps.workadventure.test/hq/wokas/hq-camiseta.png",
  },
  {
    parte: "accessory",
    id: "hq-cracha",
    name: "Cracha HQ",
    url: "http://maps.workadventure.test/hq/wokas/hq-cracha.png",
  },
];

// Catalogo unico da loja: skins (roupa) e companions (bicho) vivem em arquivos
// separados porque so a skin entra na lista de Woka; o tipo viaja junto no item.
function catalogoDaLoja() {
  return [
    ...lerDadosJson("catalogo-skins.json").map((item) => ({ ...item, tipo: "skin" })),
    ...lerDadosJson("catalogo-companions.json").map((item) => ({ ...item, tipo: "companion" })),
  ];
}

function inventarioDe(cadastro, tipo) {
  const inventario = lerDadosJson("inventario.json");
  const itens = cadastro ? inventario[cadastro.pessoa.uuid] ?? [] : [];
  return new Set(itens.filter((item) => item.tipo === tipo).map((item) => item.item_id));
}

function listaWokaPara(cadastro) {
  const base = JSON.parse(readFileSync(CAMINHO_WOKA_BASE, "utf8"));
  const resgatadas = inventarioDe(cadastro, "skin");
  const chiques = lerDadosJson("catalogo-skins.json")
    .filter((skin) => resgatadas.has(skin.id))
    .map((skin) => ({ id: skin.id, name: skin.nome, url: skin.textura }));
  base.woka ??= { collections: [] };
  base.woka.collections.push({ name: "Chiques", textures: chiques });
  for (const peca of PECAS_HQ) {
    base[peca.parte] ??= { collections: [] };
    base[peca.parte].collections ??= [];
    let colecao = base[peca.parte].collections.find((item) => item.name === "HQ");
    if (!colecao) {
      colecao = { name: "HQ", textures: [] };
      base[peca.parte].collections.push(colecao);
    }
    colecao.textures.push({ id: peca.id, name: peca.name, url: peca.url });
  }
  return base;
}

// Bichos de estimacao: so aparecem no seletor de companion de quem resgatou.
function listaCompanionPara(cadastro) {
  const resgatados = inventarioDe(cadastro, "companion");
  const texturas = lerDadosJson("catalogo-companions.json")
    .filter((bicho) => resgatados.has(bicho.id))
    .map((bicho) => ({
      id: bicho.id,
      name: bicho.nome,
      url: bicho.textura,
      ...(bicho.behavior ? { behavior: bicho.behavior } : {}),
    }));
  if (texturas.length === 0) return [];
  return [{ name: "Bichos do HQ", position: 0, textures: texturas }];
}

function companionPermitido(cadastro, id) {
  if (!id) return null;
  for (const colecao of listaCompanionPara(cadastro)) {
    const achado = colecao.textures.find((textura) => textura.id === id);
    if (achado) return { id: achado.id, url: achado.url };
  }
  return null;
}

function mapaTexturasPermitidas(cadastro) {
  const permitidas = new Map();
  for (const parte of Object.values(listaWokaPara(cadastro))) {
    for (const colecao of parte.collections ?? []) {
      for (const textura of colecao.textures ?? []) {
        permitidas.set(textura.id, { id: textura.id, url: textura.url });
      }
    }
  }
  return permitidas;
}

function parametrosArray(url, nome) {
  const valores = [];
  for (const [chave, valor] of url.searchParams.entries()) {
    if (chave === nome || chave === `${nome}[]` || chave.startsWith(`${nome}[`)) {
      valores.push(valor);
    }
  }
  return valores;
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

  try {
    fecharSemana(semanaISO(Date.now() - 7 * 86_400_000));
  } catch (erro) {
    console.error("[vip] fechamento_lazy_falhou:", erro.message);
  }

  if (req.method === "OPTIONS") return responder(204, {});

  if (req.method === "GET" && url.pathname === "/vip") {
    return responder(200, lerDadosJson("vip.json"));
  }

  if (req.method === "POST" && url.pathname === "/vip/invasao") {
    try {
      const pedido = await lerCorpoJson(req);
      const cadastro = acharPessoaDados(lerDadosJson("pessoas.json"), pedido.nome);
      const vip = lerDadosJson("vip.json");
      if (cadastro?.pessoa?.squad && cadastro.pessoa.squad === vip.squad_vencedor) {
        return responder(200, { status: "autorizado" });
      }
      const invasao = {
        nome: pedido.nome ?? null,
        uuid: cadastro?.pessoa?.uuid ?? null,
        squad: cadastro?.pessoa?.squad ?? null,
        detentor: vip.squad_vencedor,
        ts: new Date().toISOString(),
      };
      appendFileSync(CAMINHO_INVASOES_VIP, `${JSON.stringify(invasao)}\n`);
      console.error(
        `[vip] invasao ${invasao.nome ?? "desconhecido"} · detentor ${invasao.detentor ?? "vazio"}`,
      );
      return responder(202, { status: "invasao_registrada" });
    } catch (erro) {
      return responder(400, { erro: erro.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/placar/semana") {
    try {
      const semana = url.searchParams.get("semana") || semanaISO(Date.now());
      const saldos = estadoPontos.semanas[semana]?.saldos ?? {};
      return responder(200, montarPlacar(saldos, semana));
    } catch (erro) {
      return responder(500, { erro: erro.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/placar/geral") {
    try {
      return responder(200, montarPlacar(estadoPontos.saldos));
    } catch (erro) {
      return responder(500, { erro: erro.message });
    }
  }

  // Vitrine da loja: skin (roupa) e companion (bicho) no mesmo corpo, com tipo.
  if (req.method === "GET" && url.pathname === "/catalogo") {
    try {
      return responder(200, catalogoDaLoja());
    } catch (erro) {
      return responder(500, { erro: erro.message });
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/saldo/")) {
    try {
      const nome = decodeURIComponent(url.pathname.slice("/saldo/".length));
      const cadastro = resolverPessoa(lerDadosJson("pessoas.json"), {
        uuid: url.searchParams.get("uuid"),
        nome,
      });
      if (!cadastro) return responder(404, { erro: "pessoa nao encontrada" });
      const inventario = lerDadosJson("inventario.json");
      return responder(200, {
        nome: cadastro.nome,
        uuid: cadastro.pessoa.uuid,
        pontos: estadoPontos.saldos[`pessoa:${cadastro.pessoa.uuid}`] ?? 0,
        inventario: inventario[cadastro.pessoa.uuid] ?? [],
      });
    } catch (erro) {
      return responder(500, { erro: erro.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/resgate") {
    try {
      const pedido = await lerCorpoJson(req);
      const cadastro = resolverPessoa(lerDadosJson("pessoas.json"), pedido);
      if (!cadastro) return responder(404, { erro: "pessoa nao encontrada" });
      const alvo = catalogoDaLoja().find((item) => item.id === pedido.item_id);
      if (!alvo) return responder(404, { erro: "item nao encontrado" });
      const inventario = lerDadosJson("inventario.json");
      const itens = Array.isArray(inventario[cadastro.pessoa.uuid])
        ? inventario[cadastro.pessoa.uuid]
        : [];
      const existente = itens.find((item) => item.item_id === alvo.id);
      const saldo = estadoPontos.saldos[`pessoa:${cadastro.pessoa.uuid}`] ?? 0;
      if (existente) {
        return responder(200, {
          status: "ja_resgatado",
          item_id: alvo.id,
          tipo: alvo.tipo,
          pontos: saldo,
          granted_from: existente.granted_from,
        });
      }
      if (saldo < alvo.preco_pontos) {
        return responder(409, {
          erro: "pontos insuficientes",
          pontos: saldo,
          necessario: alvo.preco_pontos,
        });
      }
      const agora = new Date().toISOString();
      const lancamento = {
        entry_id: randomUUID(),
        event_id: `resgate:${cadastro.pessoa.uuid}:${alvo.id}:${randomUUID()}`,
        tipo: "debito",
        sujeito: `pessoa:${cadastro.pessoa.uuid}`,
        delta: -alvo.preco_pontos,
        motivo: `resgate_${alvo.tipo}`,
        item_id: alvo.id,
        semana: semanaISO(agora),
        ts: agora,
      };
      registrarLancamentos([lancamento]);
      itens.push({ item_id: alvo.id, tipo: alvo.tipo, granted_from: lancamento.entry_id });
      inventario[cadastro.pessoa.uuid] = itens;
      gravarDadosJson("inventario.json", inventario);
      console.log(`[resgate] ${cadastro.nome} resgatou ${alvo.id} por ${alvo.preco_pontos}`);
      return responder(201, {
        status: "resgatado",
        item_id: alvo.id,
        tipo: alvo.tipo,
        pontos: saldo - alvo.preco_pontos,
        granted_from: lancamento.entry_id,
      });
    } catch (erro) {
      console.error("[resgate] falha:", erro.message);
      return responder(400, { erro: erro.message });
    }
  }

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
    const camposValidos = ["event_id", "order_id"].every(
      (campo) => typeof venda[campo] === "string" && venda[campo].trim(),
    );
    const ativador =
      typeof venda.ativador === "string" && venda.ativador.trim() ? venda.ativador : null;
    // Venda nascida do gatilho do CRM nao carrega vendedor: `funnel_events` nao
    // tem coluna de pessoa (so atribuicao de campanha), entao o `grupo` credita
    // SO o squad em vez de a venda inteira ser recusada.
    const grupo = typeof venda.grupo === "string" && venda.grupo.trim() ? venda.grupo : null;
    if (!camposValidos || (!ativador && !grupo) || typeof venda.timestamp !== "string") {
      console.error("[webhook/venda] schema_incompleto");
      return responder(400, { erro: "schema incompleto" });
    }
    if (eventosVenda.has(venda.event_id)) {
      console.log(`[webhook/venda] duplicado ${venda.event_id}`);
      return responder(200, { status: "duplicado" });
    }

    let cadastro = null;
    let squadId = null;
    try {
      const squads = lerDadosJson("squads.json");
      if (ativador) {
        cadastro = acharPessoaDados(lerDadosJson("pessoas.json"), ativador);
        squadId = cadastro?.pessoa?.squad ?? null;
      } else {
        const mapa = lerDadosJson("atribuicao-squads.json");
        squadId = mapa[grupo] ?? mapa["*"] ?? null;
      }
      if (squadId && !squads[squadId]) squadId = null;
    } catch (erro) {
      return responder(500, { erro: erro.message });
    }
    if (!squadId) {
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
      const lancamentos = [];
      if (cadastro?.pessoa?.uuid) {
        lancamentos.push({
          entry_id: randomUUID(),
          event_id: venda.event_id,
          tipo: "credito",
          sujeito: `pessoa:${cadastro.pessoa.uuid}`,
          delta: config.pontos_ativador,
          motivo: "venda",
          semana,
          ts: venda.timestamp,
        });
      }
      lancamentos.push({
        entry_id: randomUUID(),
        event_id: venda.event_id,
        tipo: "credito",
        sujeito: `squad:${squadId}`,
        delta: config.pontos_squad,
        motivo: "venda",
        semana,
        ts: venda.timestamp,
      });
      // Venda sem vendedor (so grupo): o squad divide entre os seus. A linha de
      // squad continua inteira porque e' ela que o placar le; as linhas de
      // pessoa somam EXATAMENTE pontos_squad (10 divididos por N), nunca 10 para
      // cada — senao a moeda da loja inflaria N vezes por venda.
      if (!cadastro) {
        const membros = membrosDoSquad(lerDadosJson("pessoas.json"), squadId);
        if (!membros.length) {
          console.log(
            `[webhook/venda] squad_sem_membros ${squadId} ${venda.event_id}: so linha de squad`,
          );
        }
        const fatias = membros.length ? repartirPontos(config.pontos_squad, membros.length) : [];
        membros.forEach((membro, indice) => {
          lancamentos.push({
            entry_id: randomUUID(),
            event_id: venda.event_id,
            tipo: "credito",
            sujeito: `pessoa:${membro.uuid}`,
            delta: fatias[indice],
            motivo: "venda",
            origem: "divisao_squad",
            squad: squadId,
            semana,
            ts: venda.timestamp,
          });
        });
      }
      if (lancamentos.some((item) => !Number.isFinite(item.delta))) {
        throw new Error("config-pontos.json contem valor invalido");
      }
      registrarLancamentos(lancamentos);
      let sino = "disparado";
      try {
        const squads = lerDadosJson("squads.json");
        await dispararSinoGlobal(cadastro?.nome ?? squads[squadId].nome, squadId);
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

  // A porta do HQ pergunta: essa identidade pode pisar na Diretoria?
  if (req.method === "GET" && url.pathname === "/api/diretoria/acesso") {
    try {
      const nome = url.searchParams.get("nome");
      const modo = lerDadosJson("config-diretoria.json").modo;
      if (modo === "aberta") return responder(200, { acesso: true, motivo: "diretoria aberta" });
      const cadastro = acharPessoaDados(lerDadosJson("pessoas.json"), nome);
      if (cadastro?.pessoa?.tags?.includes("diretoria")) {
        return responder(200, { acesso: true, motivo: "tag diretoria" });
      }
      return responder(403, { acesso: false, motivo: "sem tag diretoria" });
    } catch (erro) {
      return responder(500, { erro: erro.message });
    }
  }

  // A sala VIP pergunta: esse uuid pode entrar? Quem decide e' o servidor.
  if (req.method === "GET" && url.pathname === "/api/vip/acesso") {
    try {
      const vip = lerDadosJson("vip.json");
      const cadastro = resolverPessoa(lerDadosJson("pessoas.json"), {
        uuid: url.searchParams.get("uuid"),
        nome: url.searchParams.get("nome"),
      });
      if (vip.squad_vencedor && cadastro?.pessoa?.squad === vip.squad_vencedor) {
        return responder(200, {
          acesso: true,
          motivo: `squad ${vip.squad_vencedor} venceu a semana`,
          squad_vencedor: vip.squad_vencedor,
        });
      }
      return responder(403, {
        acesso: false,
        motivo: vip.squad_vencedor
          ? `sala reservada ao squad ${vip.squad_vencedor}`
          : "nenhum squad venceu a semana ainda",
        squad_vencedor: vip.squad_vencedor ?? null,
      });
    } catch (erro) {
      return responder(500, { erro: erro.message });
    }
  }

  // Primeiro login casa o nome do cadastro com o uuid do jogador.
  // uuid null em pessoas.json = ainda nao vinculado; substitui o marcador de
  // pendencia de identidade que vivia no cadastro (removido em 04/09/2026).
  if (req.method === "POST" && url.pathname === "/api/pessoas/vincular") {
    try {
      const pedido = await lerCorpoJson(req);
      const nome = String(pedido.nome ?? "").trim();
      const uuid = String(pedido.uuid ?? "").trim();
      if (!nome || !uuid) return responder(400, { erro: "nome e uuid sao obrigatorios" });
      const pessoas = lerDadosJson("pessoas.json");
      const cadastro = acharPessoaDados(pessoas, nome);
      if (!cadastro) return responder(404, { erro: "pessoa nao encontrada" });
      if (cadastro.pessoa.uuid) {
        if (cadastro.pessoa.uuid === uuid) {
          return responder(200, { status: "ja_vinculado", nome: cadastro.nome, uuid });
        }
        console.error(`[vincular] ${cadastro.nome} ja tem outro uuid`);
        return responder(409, { erro: "pessoa ja vinculada a outro uuid", nome: cadastro.nome });
      }
      const dono = resolverPessoa(pessoas, { uuid });
      if (dono) {
        console.error(`[vincular] uuid ja pertence a ${dono.nome}`);
        return responder(409, { erro: "uuid ja pertence a outra pessoa", nome: dono.nome });
      }
      pessoas[cadastro.nome] = { ...cadastro.pessoa, uuid };
      gravarDadosJson("pessoas.json", pessoas);
      console.log(`[vincular] ${cadastro.nome} -> ${uuid}`);
      return responder(201, { status: "vinculado", nome: cadastro.nome, uuid });
    } catch (erro) {
      return responder(400, { erro: erro.message });
    }
  }

  if (req.method === "GET" && url.pathname.startsWith("/pessoas/")) {
    try {
      const nome = decodeURIComponent(url.pathname.slice("/pessoas/".length));
      const cadastro = acharPessoaDados(lerDadosJson("pessoas.json"), nome);
      if (!cadastro) return responder(404, { erro: "pessoa nao encontrada" });
      return responder(200, {
        uuid: cadastro.pessoa.uuid,
        squad: cadastro.pessoa.squad,
        tags: cadastro.pessoa.tags ?? [],
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

  // Aparencia dos avatares: base nativa mais a colecao Chiques resgatada pelo jogador.
  if (req.method === "GET" && url.pathname === "/api/woka/list") {
    try {
      const cadastro = acharPessoaDados(
        lerDadosJson("pessoas.json"),
        url.searchParams.get("uuid"),
      );
      return responder(200, listaWokaPara(cadastro));
    } catch (erro) {
      return responder(500, { erro: erro.message });
    }
  }

  // Bichos: o seletor de companion so mostra o que a pessoa resgatou na loja.
  if (req.method === "GET" && url.pathname === "/api/companion/list") {
    try {
      const cadastro = resolverPessoa(lerDadosJson("pessoas.json"), {
        uuid: url.searchParams.get("uuid"),
        nome: url.searchParams.get("uuid"),
      });
      return responder(200, listaCompanionPara(cadastro));
    } catch (erro) {
      return responder(500, { erro: erro.message });
    }
  }

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
    const texturasPedidas = parametrosArray(url, "characterTextureIds");
    const texturasPermitidas = mapaTexturasPermitidas(cadastro);
    const characterTextures = texturasPedidas
      .map((id) => texturasPermitidas.get(id))
      .filter(Boolean);
    const texturasValidas =
      texturasPedidas.length > 0 && characterTextures.length === texturasPedidas.length;
    // O bicho pedido so vale se estiver no inventario de quem pediu.
    const companionPedido = url.searchParams.get("companionTextureId");
    const companionTexture = companionPermitido(cadastro, companionPedido);
    const corpo = {
      status: "ok",
      email: identificador ?? null,
      userUuid: cadastro?.pessoa?.uuid ?? identificador ?? "anonimo",
      tags,
      visitCardUrl: null,
      isCharacterTexturesValid: texturasValidas,
      characterTextures,
      isCompanionTextureValid: !companionPedido || companionTexture !== null,
      companionTexture,
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
      "/api/diretoria/acesso",
      "/api/vip/acesso",
      "/api/pessoas/vincular",
      "/webhook/venda",
      "/webhook/estorno",
      "/placar/semana",
      "/placar/geral",
      "/vip",
      "/vip/invasao",
      "/catalogo",
      "/saldo/:nome",
      "/resgate",
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

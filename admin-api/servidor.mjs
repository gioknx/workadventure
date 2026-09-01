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
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.ADMIN_API_PORT ?? 8901);
const DADOS = join(AQUI, "dados");

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

async function lerCorpoJson(req) {
  let corpo = "";
  for await (const parte of req) {
    corpo += parte;
    if (corpo.length > 1_000_000) throw new Error("corpo excede 1 MB");
  }
  return corpo ? JSON.parse(corpo) : {};
}

function gravarDadosJson(nome, dados) {
  const destino = join(DADOS, nome);
  const temporario = `${destino}.tmp`;
  writeFileSync(temporario, `${JSON.stringify(dados, null, 2)}\n`);
  renameSync(temporario, destino);
}

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
    rotas: ["/pessoas/:nome", "/squads", "/diretoria/modo", "/api/room/access", "/api/lista"],
  });
});

server.listen(PORTA, () => {
  const l = convidados();
  console.log(`painel no ar em http://localhost:${PORTA}`);
  console.log(`mundo ${l.aberto ? "ABERTO" : "FECHADO"} · ${l.pessoas.length} na lista`);
});

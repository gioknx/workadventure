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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PORTA = 8901;

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

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORTA}`);
  const lista = convidados();
  const responder = (codigo, corpo) => {
    res.writeHead(codigo, { "Content-Type": "application/json" });
    res.end(JSON.stringify(corpo));
    console.log(`${codigo} ${url.pathname}${url.search}`);
  };

  // O jogo pergunta primeiro: que versao de API voce fala?
  if (url.pathname === "/api/capabilities") {
    return responder(200, { "api/woka/list": "v1", "api/companion/list": "v1" });
  }

  // Aparencia dos avatares e companheiros: devolve o padrao do proprio jogo
  if (url.pathname === "/api/woka/list" || url.pathname === "/api/companion/list") {
    return responder(200, {});
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

  // O jogo pergunta: esse cara pode entrar nesta sala?
  if (url.pathname === "/api/room/access") {
    const email = url.searchParams.get("userIdentifier");
    const pessoa = achar(lista, email);

    if (!lista.aberto && !pessoa) {
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
    if (pessoa?.banido) {
      return responder(200, {
        status: "error",
        type: "error",
        code: "BANIDO",
        title: "Acesso removido",
        subtitle: "Voce foi banido deste mundo.",
        details: pessoa.motivo ?? "",
        image: "",
      });
    }
    const corpo = {
      status: "ok",
      email,
      userUuid: email ?? "anonimo",
      tags: pessoa?.papeis ?? [],
      visitCardUrl: null,
      isCharacterTexturesValid: true,
      characterTextures: [],
      isCompanionTextureValid: true,
      companionTexture: null,
      messages: [],
      activatedInviteUser: true,
      canEdit: Boolean(pessoa?.papeis?.includes("admin")),
      world: "hq",
    };
    if (pessoa) corpo.username = pessoa.email.split("@")[0];
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

  responder(404, { erro: "rota desconhecida", rotas: ["/api/room/access", "/api/lista"] });
});

server.listen(PORTA, () => {
  const l = convidados();
  console.log(`painel no ar em http://localhost:${PORTA}`);
  console.log(`mundo ${l.aberto ? "ABERTO" : "FECHADO"} · ${l.pessoas.length} na lista`);
});

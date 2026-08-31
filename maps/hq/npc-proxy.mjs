/**
 * Proxy do NPC — guarda a chave do LLM fora do navegador.
 *
 * O script do mapa roda no navegador de quem entra no mundo. Se a chave do
 * OpenRouter fosse escrita la, qualquer visitante a leria. Este proxy fica na
 * maquina do Mind: recebe a pergunta, adiciona a chave e devolve so a resposta.
 *
 * Chave: lida do Keychain via ~/.omp/credenciais.sh (nunca em arquivo).
 * Porta: 8899.
 */

import { createServer } from "node:http";
import { execFileSync } from "node:child_process";

const PORTA = 8899;
const MODELO = "claude-haiku-4-5";

// Conexoes proprias do Mind (auth2api rodando nesta maquina), nao OpenRouter.
const BASE = "http://127.0.0.1:8319/v1/chat/completions";
const CHAVE = execFileSync(
  process.env.HOME + "/.omp/credenciais.sh",
  ["user", "auth2api-gio"],
  { encoding: "utf8" }
).trim();

const PERSONA =
  "Voce e o guia do HQ, um mundo virtual WorkAdventure que roda na maquina do Mind. " +
  "Responda em portugues do Brasil, no maximo 2 frases curtas, tom simpatico e direto. " +
  "O HQ tem: Laboratorio, Cafe e Palco (dao 10 XP cada), Sala de Foco (silenciosa), " +
  "Sala de Reuniao e Recepcao. Quem visita as 3 zonas de XP ganha o badge Explorador do HQ.";

createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method !== "POST") return res.writeHead(405).end("use POST");

  let corpo = "";
  for await (const parte of req) corpo += parte;

  let pergunta = "Quem e voce?";
  try {
    pergunta = JSON.parse(corpo).pergunta || pergunta;
  } catch {}

  try {
    const r = await fetch(BASE, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + CHAVE,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 160,
        messages: [
          { role: "system", content: PERSONA },
          { role: "user", content: pergunta },
        ],
      }),
    });
    const j = await r.json();
    const texto = j?.choices?.[0]?.message?.content ?? "(sem resposta)";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ resposta: texto }));
    console.log("[proxy] " + pergunta + " -> " + texto.slice(0, 70));
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ resposta: "O guia esta sem sinal agora." }));
    console.error("[proxy] erro", e.message);
  }
}).listen(PORTA, () => console.log("[proxy] NPC ouvindo na porta " + PORTA));

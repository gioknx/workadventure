/**
 * Grupo 2 / experiencia 1 — Musgo do que ninguem le.
 * Le o Vault e devolve as notas que ninguem abre ha 90 dias ou mais.
 * Sem escrita: so stat de arquivo.
 */
import { createServer } from "node:http";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { homedir } from "node:os";

const HOST = "127.0.0.1";
const PORT = 8900;
const VAULT = join(homedir(), "Documents", "Obsidian", "Vault");
const DIAS_MUSGO = 21;
const ESTANTES = 3;
const IGNORAR = new Set([".git", ".obsidian", "node_modules", "_ARQUIVO", "assets", ".trash"]);

async function varrer(dir, saida, profundidade = 0) {
  if (profundidade > 4) return;
  let entradas;
  try {
    entradas = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entrada of entradas) {
    if (entrada.name.startsWith(".") || IGNORAR.has(entrada.name)) continue;
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      await varrer(caminho, saida, profundidade + 1);
    } else if (entrada.name.endsWith(".md")) {
      try {
        const s = await stat(caminho);
        const usado = s.mtimeMs;
        saida.push({ caminho, usado });
      } catch {
        /* arquivo sumiu no meio da varredura */
      }
    }
  }
}

async function estantes() {
  const notas = [];
  await varrer(VAULT, notas);
  const agora = Date.now();
  const dia = 24 * 60 * 60 * 1000;
  const esquecidas = notas
    .map((n) => ({ ...n, dias: Math.floor((agora - n.usado) / dia) }))
    .filter((n) => n.dias >= DIAS_MUSGO)
    .sort((a, b) => b.dias - a.dias)
    .slice(0, ESTANTES)
    .map((n, i) => ({
      estante: i + 1,
      titulo: n.caminho.split("/").pop().replace(/\.md$/, ""),
      pasta: relative(VAULT, n.caminho).split("/").slice(0, -1).join("/") || "raiz",
      dias: n.dias,
    }));

  return { atualizadoEm: agora, totalNotas: notas.length, limiteDias: DIAS_MUSGO, estantes: esquecidas };
}
const CACHE_MS = 60 * 1000;
let cache = null;

async function estantesComCache() {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.corpo;
  const corpo = await estantes();
  cache = { em: Date.now(), corpo };
  return corpo;
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method !== "GET") return res.writeHead(405).end();

  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname === "/saude") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (url.pathname !== "/musgo") return res.writeHead(404).end();

  try {
    const corpo = await estantesComCache();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(corpo));
  } catch (erro) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ erro: "Vault indisponivel", detalhe: String(erro.message || erro) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[musgo] http://${HOST}:${PORT}/musgo`);
});

server.on("error", (erro) => {
  console.error(`[musgo] nao subiu em ${HOST}:${PORT} — ${erro.code || erro.message}`);
  process.exitCode = 1;
});

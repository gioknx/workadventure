import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { basename } from "node:path";

const HOST = "127.0.0.1";
const PORT = 8898;
const CAPACIDADE = 8;
const ESTADOS_PRESENTES = new Set(["working", "blocked"]);

function snapshot() {
  return new Promise((resolve, reject) => {
    execFile("herdr", ["api", "snapshot"], { encoding: "utf8", timeout: 3000, maxBuffer: 2_000_000 }, (erro, stdout) => {
      if (erro) return reject(erro);
      try {
        resolve(JSON.parse(stdout)?.result?.snapshot?.agents ?? []);
      } catch (falha) {
        reject(falha);
      }
    });
  });
}

function tarefa(agent) {
  return agent.terminal_title_stripped || agent.terminal_title || "Tarefa sem titulo";
}

function projeto(agent) {
  const cwd = agent.foreground_cwd || agent.cwd || "";
  return cwd ? basename(cwd) : "sem projeto";
}

async function agentesPresentes() {
  const agentes = (await snapshot())
    .filter((agent) => ESTADOS_PRESENTES.has(agent.agent_status))
    .map((agent) => ({
      id: agent.pane_id,
      nome: agent.name || `${agent.agent || "agente"} ${agent.pane_id}`,
      tarefa: tarefa(agent),
      projeto: projeto(agent),
      estado: agent.agent_status,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    atualizadoEm: Date.now(),
    capacidade: CAPACIDADE,
    ocupados: agentes.slice(0, CAPACIDADE),
    fila: agentes.slice(CAPACIDADE),
    totalPresentes: agentes.length,
  };
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
  if (url.pathname !== "/agentes") return res.writeHead(404).end();

  try {
    const corpo = await agentesPresentes();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(corpo));
  } catch (erro) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ erro: "Herdr indisponivel", detalhe: String(erro.message || erro) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[mesa-agentes] http://${HOST}:${PORT}/agentes`);
});

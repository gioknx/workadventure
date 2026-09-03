# Catálogo de reações do mundo — contrato

O mundo reage a eventos por **catálogo**, não por script. Reação nova = uma linha em
`reacoes.json`. Nenhum arquivo `.js` novo, nenhuma tag nova em `quest.html`.

Quem lê o catálogo: `motor-reacoes.js`. Quem sabe executar cada verbo: `motor-acoes.js`.

## Formato

`reacoes.json` contém **apenas** `{"regras": [ ... ]}`. JSON não tem comentário — a
explicação mora aqui, e só aqui.

```json
{
  "id": "venda-sino",
  "quando": "crm-matricula_view",
  "se": { "stage": "conversion" },
  "faz": [
    { "acao": "som", "url": "sons/sino.mp3", "volume": 0.72 },
    { "acao": "banner", "texto": "🔔 VENDA · {ownerLabel|equipe} · {productLabel}", "segundos": 8 }
  ],
  "silencio": 3000,
  "teto_por_minuto": 6
}
```

| campo | obrigatório | o que é |
|---|---|---|
| `id` | sim | string única no catálogo. Id repetido → o motor **recusa o catálogo inteiro** no boot e loga `[motor] id repetido: <id>`. |
| `quando` | sim | nome do evento em `WA.event.on`. Sufixo `*` é curinga de prefixo: `crm-quiz_*`. |
| `se` | não | igualdade estrita sobre campos do `data` do evento. Todas as chaves precisam bater. Ausente = sempre casa. Só igualdade — nada de operador, para o catálogo não virar linguagem. |
| `faz` | sim | array de ações, executadas em ordem, uma esperando a anterior. |
| `silencio` | não | ms de silêncio após disparar. Disparo dentro da janela é descartado com log. Default `0`. |
| `teto_por_minuto` | não | máximo de disparos da regra por minuto, janela deslizante. Default `12`. |

**Curinga:** `WA.event.on` exige nome literal. O motor expande `crm-*` contra a constante
`EVENTOS_CRM`, no topo de `motor-reacoes.js`. Fonte nova de eventos = acrescentar os nomes
dela nessa constante uma vez.

## Interpolação

Em qualquer string de parâmetro, `{campo}` vira `data.campo` do evento. `{{` escapa chave
literal.

`{campo|padrão}` usa o padrão quando o campo vier ausente, nulo ou vazio — o barramento
manda `actorLabel: null` quando não há rótulo. Sem o `|`, campo vazio vira string vazia,
e o texto sai com separador solto (`VENDA ·  ·`).

O verbo `contador` publica o novo total como `{total}` para as ações **seguintes da mesma
regra**.

## Verbos

| verbo | params | API por trás |
|---|---|---|
| `som` | `url`, `volume` (0.7) | `WA.sound.loadSound(url).play({volume})` |
| `banner` | `texto`, `cor` (`#8A6D1D`), `corTexto` (`#ffffff`), `segundos` (8) | `WA.ui.banner.openBanner` |
| `mensagem` | `texto` | `WA.ui.displayActionMessage` |
| `chat` | `texto` | `WA.chat.sendChatMessage` |
| `modal` | `titulo`, `url`, `posicao` (`right`) | `WA.ui.modal.openModal` |
| `camada` | `nome`, `visivel` (bool) | `WA.room.showLayer` / `hideLayer` |
| `camada_piscar` | `nome`, `vezes` (3), `intervalo` (400) | alterna show/hide, termina escondida |
| `tiles` | `lista`: `[{x,y,tile,layer}]` | `WA.room.setTiles` |
| `propriedade` | `camada`, `nome`, `valor` | `WA.room.setProperty` |
| `destaque` | `cor` hex (`#FFD700`), `segundos` (60) | `WA.player.setOutlineColor` + `removeOutlineColor` no fim |
| `contador` | `chave`, `passo` (1) | `WA.state.loadVariable` + `saveVariable`; expõe `{total}` |
| `site` | `url`, `largura` (40) | `WA.nav.openCoWebSite` |

Não há verbo de partícula, sprite ou NPC: a API do WorkAdventure não tem nenhum dos três.
Efeito visual arbitrário se faz como camada de tile desenhada no `.tmj`, mostrada e
escondida — é assim que `g2-confete.js` funciona. Use `camada` ou `camada_piscar`.

## Tolerância a falha

- Verbo desconhecido → pula **essa ação**, loga `[motor] acao desconhecida`, segue as demais.
- Ação que estoura → loga `[motor] falha <acao> <regra>`, segue a próxima ação.
- Regra malformada (sem `id` string, sem `quando`, `faz` vazio) → descartada sozinha, com log.
- Catálogo inválido ou fora do ar → motor fica inerte. Nenhum outro script do mundo é afetado.

## Travas

`WA.event.on` entrega a **todos** os clientes da sala: cada reação roda em N navegadores.
Por isso as travas moram no motor, não no catálogo:

1. silêncio da regra → `[motor] silencio <id>`
2. teto por minuto da regra → `[motor] teto <id>`
3. teto global de 20 execuções/minuto somando tudo → `[motor] teto global`

Fila FIFO única, uma regra por vez, teto de 30 itens. Cheia, o item novo é descartado.

## Inspeção

No console do navegador: `window.__motorReacoes` → `{regras, disparos, descartes}`.

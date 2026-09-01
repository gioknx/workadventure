#!/usr/bin/env bash
set -euo pipefail

DADOS="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/dados" && pwd)"

: > "$DADOS/ledger.jsonl"
: > "$DADOS/vendas-orfas.jsonl"
: > "$DADOS/invasoes-vip.jsonl"
printf '%s\n' '{' '  "saldos": {},' '  "semanas": {}' '}' > "$DADOS/estado-pontos.json"
printf '%s\n' '{}' > "$DADOS/inventario.json"
printf '%s\n' '{' '  "semana": null,' '  "squad_vencedor": null,' '  "desde": null' '}' > "$DADOS/vip.json"

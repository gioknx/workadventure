#!/usr/bin/env bash
# Sobe o HQ inteiro num gesto: containers + hosts + proxy do NPC.
#
# Existe porque tres coisas precisam estar de pe ao mesmo tempo, e duas quebram
# sozinhas: o IP do traefik muda a cada recriacao, e o proxy do NPC nao sobe
# junto com o Docker.
#
# Uso:  ./subir-hq.sh
# Sai 0 quando o mundo responde 200 E o proxy responde.

set -uo pipefail
cd "$(dirname "$0")"

echo "==> containers"
docker compose up -d >/dev/null 2>&1
docker compose ps --format '{{.Name}} {{.Status}}' | sed 's/^/    /'

echo "==> hosts"
./reapontar-hosts.sh || { echo "    FALHOU: mundo nao respondeu 200"; exit 1; }

echo "==> painel de admin"
if curl -s -m 3 -o /dev/null http://localhost:8901/api/lista; then
  echo "    ja estava de pe"
else
  nohup node --env-file=.env admin-api/servidor.mjs > /tmp/admin-api.log 2>&1 &
  sleep 2
  curl -s -m 5 -o /dev/null http://localhost:8901/api/lista \
    && echo "    subiu" || { echo "    FALHOU: /tmp/admin-api.log"; exit 1; }
fi

echo "==> memoria do Vault (musgo)"
if curl -s -m 3 -o /dev/null http://localhost:8900/saude; then
  echo "    ja estava de pe"
else
  nohup node maps/hq/vault-musgo-server.mjs > /tmp/musgo.log 2>&1 &
  sleep 2
  curl -s -m 5 -o /dev/null http://localhost:8900/saude \
    && echo "    subiu" || { echo "    FALHOU: /tmp/musgo.log"; exit 1; }
fi

echo "==> proxy do NPC"
if curl -s -m 3 -o /dev/null -X POST http://localhost:8899 \
     -H 'Content-Type: application/json' -d '{"pergunta":"ping"}'; then
  echo "    ja estava de pe"
else
  nohup node maps/hq/npc-proxy.mjs > /tmp/npc-proxy.log 2>&1 &
  sleep 3
  if curl -s -m 10 -o /dev/null -X POST http://localhost:8899 \
       -H 'Content-Type: application/json' -d '{"pergunta":"ping"}'; then
    echo "    subiu (log em /tmp/npc-proxy.log)"
  else
    echo "    FALHOU: veja /tmp/npc-proxy.log"; exit 1
  fi
fi

echo
echo "HQ no ar: http://play.workadventure.test/_/global/maps.workadventure.test/hq/hq.tmj"

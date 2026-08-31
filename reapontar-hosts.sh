#!/usr/bin/env bash
# E0.4 — reaponta /etc/hosts para o IP atual do container traefik.
#
# Por que existe: a porta 80 desta maquina ja tem outro processo, entao o traefik
# do WorkAdventure nao publica em 127.0.0.1 — os hosts precisam apontar para o IP
# do container, que muda a cada recriacao do compose.
#
# Uso:  ./reapontar-hosts.sh
# Sai 0 quando play.workadventure.test responde 200.

set -euo pipefail

CONTAINER="workadventure-reverse-proxy-1"
DOMINIO="workadventure.test"
SUBS="play pusher api front maps icon extra oidc redisinsight map-storage ejabberd"

ip=$(docker inspect "$CONTAINER" \
  --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null || true)

if [ -z "$ip" ]; then
  echo "ERRO: container $CONTAINER nao esta de pe. Rode 'docker compose up -d' antes." >&2
  exit 1
fi

atual=$(awk -v d="$DOMINIO" '$0 ~ d && $1 !~ /^#/ {print $1; exit}' /etc/hosts || true)

if [ "$atual" = "$ip" ]; then
  echo "hosts ja aponta para $ip — nada a fazer"
else
  echo "reapontando $DOMINIO: ${atual:-<vazio>} -> $ip"
  linha="$ip"
  for s in $SUBS; do linha="$linha $s.$DOMINIO"; done

  senha=$(~/.omp/credenciais.sh get mac-admin)
  novo=$(mktemp)
  awk -v d="$DOMINIO" '$0 !~ d' /etc/hosts > "$novo"
  echo "$linha" >> "$novo"
  echo "$senha" | sudo -S cp "$novo" /etc/hosts
  rm -f "$novo"
fi

code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://play.$DOMINIO/" || true)
echo "play.$DOMINIO -> $code"
[ "$code" = "200" ]

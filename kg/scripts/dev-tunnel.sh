#!/usr/bin/env bash
# SSH forwards from this workstation to the smr stack on the server, for
# local development (npm run dev / seed scripts). The stack publishes
# mongodb and kg-service on the server's loopback only, so -L picks them
# up without exposing anything on the LAN.
#
# Usage:
#   ./scripts/dev-tunnel.sh <server>          # e.g. user@aconcagua or an ssh alias
#   KG_SERVER=user@server ./scripts/dev-tunnel.sh
#
# Forwards (local port -> server loopback):
#   33332 -> ollama      
#   33335 -> mongodb     (MONGODB_URI in .env.local)
#   33336 -> kg-service  (KG_SERVICE_URL in .env.local)
#   33333 -> neo4j http  (browser at localhost:33333)
#   33334 -> neo4j bolt  
#   33337 -> app instance     
#
# -N: no remote command. Ctrl-C to stop. Add -f to background it.

set -euo pipefail

SERVER="${1:-${KG_SERVER:?usage: $0 <server>  (or set KG_SERVER)}}"

# Dedicated forwarding-only key on the server (authorized_keys: restrict,
# permitopen=localhost:33xxx, command=/bin/false). Falls back to the
# default key/agent if not present.
SSH_KEY="${SSH_KEY:-$HOME/.ssh/ds3_tunnel}"
KEY_OPT=()
[[ -f "$SSH_KEY" ]] && KEY_OPT=(-i "$SSH_KEY")

exec ssh -N -o ExitOnForwardFailure=yes \
  -L 33335:localhost:33335 \
  -L 33336:localhost:33336 \
  -L 33333:localhost:33333 \
  -L 33334:localhost:33334 \
  "${KEY_OPT[@]}" "$SERVER"

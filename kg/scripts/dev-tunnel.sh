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
#   33335 -> mongodb     (MONGODB_URI in .env.local)
#   33336 -> kg-service  (KG_SERVICE_URL in .env.local)
#   33333 -> neo4j http  (browser at localhost:33333, optional)
#   33334 -> neo4j bolt  (optional)
#
# -N: no remote command. Ctrl-C to stop. Add -f to background it.

set -euo pipefail

SERVER="${1:-${KG_SERVER:?usage: $0 <server>  (or set KG_SERVER)}}"

exec ssh -N \
  -L 33335:localhost:33335 \
  -L 33336:localhost:33336 \
  -L 33333:localhost:33333 \
  -L 33334:localhost:33334 \
  "$SERVER"

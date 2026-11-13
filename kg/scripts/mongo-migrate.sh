#!/usr/bin/env bash
# One-off migration: dump the app's databases from MongoDB Atlas and restore
# them into the smr stack's mongodb container (mongodb_smr_tt).
#
# Uses only docker — mongodump/mongorestore/mongosh run inside the mongo:8
# image / the container itself, nothing needs to be installed on the host.
#
# Usage (from kg/, with the stack already up):
#   ./scripts/mongo-migrate.sh
#
# Env is read from kg/.env:
#   MONGODB_SOURCE_URI  Atlas mongodb+srv:// URI (required)
#   MONGO_USER          container root user (default: mongo)
#   MONGO_PASSWORD      container root password (required)
#   MONGO_CONTAINER     target container (default: mongodb_smr_tt)
#   MONGO_TOOLS_IMAGE   image providing mongodump (default: mongo:8)
#   MIGRATE_DBS         space-separated DBs to copy
#                       (default: the DB the app reads — see src/lib/topicConfig.ts)

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${MONGODB_SOURCE_URI:?Set MONGODB_SOURCE_URI to the Atlas mongodb+srv:// URI}"
: "${MONGO_PASSWORD:?Set MONGO_PASSWORD (container root password from .env)}"
MONGO_USER="${MONGO_USER:-mongo}"
MONGO_CONTAINER="${MONGO_CONTAINER:-mongodb_smr_tt}"
MONGO_TOOLS_IMAGE="${MONGO_TOOLS_IMAGE:-mongo:8}"
MIGRATE_DBS="${MIGRATE_DBS:-smr}"

if [[ "$(docker inspect -f '{{.State.Running}}' "$MONGO_CONTAINER" 2>/dev/null)" != "true" ]]; then
  echo "ERROR: $MONGO_CONTAINER is not running — start the stack first:"
  echo "       docker compose up -d mongodb"
  exit 1
fi

for db in $MIGRATE_DBS; do
  echo "==> Dumping '$db' from Atlas and restoring into $MONGO_CONTAINER ..."
  # --network host: mongodump's Go resolver can time out on Atlas shard
  # A-records through Docker's embedded DNS; host DNS resolves them fine.
  docker run --rm --network host "$MONGO_TOOLS_IMAGE" \
    mongodump --uri="$MONGODB_SOURCE_URI" --db="$db" --archive --gzip \
  | docker exec -i "$MONGO_CONTAINER" mongorestore \
      --archive --gzip --drop \
      -u "$MONGO_USER" -p "$MONGO_PASSWORD" \
      --authenticationDatabase admin
done

echo "==> Restore finished. Collections per database:"
for db in $MIGRATE_DBS; do
  echo "--- $db"
  docker exec "$MONGO_CONTAINER" mongosh --quiet \
    -u "$MONGO_USER" -p "$MONGO_PASSWORD" --authenticationDatabase admin \
    --eval "db.getSiblingDB('$db').getCollectionNames().forEach(c => print('  ' + c + ': ' + db.getSiblingDB('$db')[c].countDocuments()))"
done

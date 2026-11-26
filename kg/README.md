# SMR stack

Fully self-hosted deployment of the SMR tech tree — **app (Next.js) +
Neo4j + Ollama + MongoDB + kg-service** on one docker network
(`smr-kg-net`). No Vercel, no Atlas. Sibling of the `fusion-kg` stack in
`~/Documents/fusion_kg_builder` — it runs alongside it on the same server
on `33xxx` ports and shares the Ollama models dir.

The `service/` code, `config.py`, `pyproject.toml`, `uv.lock` and
`Dockerfile.kg-service` were originally copied from the fusion repo's
kg-service (FastAPI agentic loop over Neo4j + Ollama, `X-API-Key` auth)
and have since been adapted to the SMR graph: entity resolution and
expansion cover `SMRDesign` / `Organisation` / `Technology` (the
`DocumentedEntity` subtypes), evidence is quote-level `EvidenceItem`s with
source-record provenance (`DOCUMENTED_IN` → `SourceRecord` →
`EXTRACTED_FROM` → `UpstreamDocument`, i.e. the IAEA SMR Technology
Catalogue 2026 and the NEA SMR Dashboard 3rd ed.), and `search_chunks`
still uses the `chunk_embeddings` vector index on `Chunk`. The app image is
built from the repo-root `Dockerfile` (Next.js `output: 'standalone'`).

## Layout

```
kg/
  docker-compose.yml     # name: smr — app, neo4j, ollama, mongodb, kg-service
  env.example            # template; real values live in .env (gitignored)
  Dockerfile.kg-service
  config.py              # kg-service settings (env-driven)
  service/               # FastAPI agentic chat over the SMR KG (adapted from fusion_kg_builder)
  scripts/mongo-migrate.sh
  scripts/dev-tunnel.sh
```

Persistent data lives outside the repo in `SMR_DATA_DIR`
(default `/mnt/data2/smr_tt_data`):

```
/mnt/data2/smr_tt_data/
  neo4j/{data,logs,import}   # bind-mounted into neo4j_smr_tt
  mongo/data                 # bind-mounted into mongodb_smr_tt
```

## Ports (host)

| Port  | Service       | Bind      |
| ----- | ------------- | --------- |
| 33332 | Ollama API    | 127.0.0.1 |
| 33333 | Neo4j Browser | 127.0.0.1 |
| 33334 | Neo4j Bolt    | 127.0.0.1 |
| 33335 | MongoDB       | 127.0.0.1 |
| 33336 | kg-service    | 127.0.0.1 |
| 33337 | app (Next.js) | 127.0.0.1 |

Inside `smr-kg-net` the containers use their standard ports
(`neo4j:7687`, `ollama:11434`, `mongodb:27017`, `kg-service:8080`,
`app:3000`). All published host ports are loopback-only by default; reach
them through SSH forwarding or expose only the app through an explicitly
configured reverse proxy. Do not expose MongoDB, Neo4j or Ollama publicly —
the app talks to MongoDB/kg-service internally.

## Deploy

```bash
cd kg
cp env.example .env    # fill in the secrets and machine-specific values
docker compose up -d --build
curl localhost:33336/health
curl localhost:33337/investment-tech-tree   # app (basePath!)
```

## MongoDB data migration (Atlas -> container)

Dataset folders under `data/extracted/` map 1:1 to MongoDB database names,
and the app discovers seeded databases dynamically (see
`scripts/seed-dataset.ts`). To port one or more databases from Atlas:

1. Put the Atlas URI in `.env` as `MONGODB_SOURCE_URI` (`env.example`
   contains the placeholder).
2. Start the stack (at least `docker compose up -d mongodb`).
3. Run `./scripts/mongo-migrate.sh` — dumps each DB from Atlas and
   restores it into `mongodb_smr_tt` (idempotent, `--drop`).

The app container gets `MONGODB_URI` / `KG_SERVICE_URL` / `KG_API_KEY` /
`ADMIN_PASSWORD` / `VOTE_SECRET` from `.env` automatically — internal
service names (`mongodb:27017`, `kg-service:8080`) are wired in the
compose file, nothing else to configure.

For local dev on a workstation, run `./scripts/dev-tunnel.sh <server>` —
it forwards `33335` (mongodb), `33336` (kg-service) and `33333`/`33334`
(Neo4j) to localhost. Create the gitignored repo-root `.env.local` with
`MONGODB_URI` / `KG_SERVICE_URL` pointed at those forwarded ports, so
`npm run dev` works against the server's data. Manual equivalent for
mongo only: `ssh -L 33335:localhost:33335 <server>` with
`MONGODB_URI=mongodb://<MONGO_USER>:<MONGO_PASSWORD>@localhost:33335/?authSource=admin`.

## Notes

- **Ollama models** are shared with the fusion stack via the bind mount
  `/mnt/data2/ollama_fusion_tt`. Concurrent reads are fine; avoid running
  `ollama pull` on both instances simultaneously.
- The Neo4j database starts empty — populate the SMR graph with the
  extraction pipeline (see fusion_kg_builder `main.py`/`enrich.py` flow).
- The app is served under the `/investment-tech-tree` basePath (from
  `next.config.ts`) — `http://<server>:33337/investment-tech-tree`.
- The app builds with `eslint.ignoreDuringBuilds` and
  `typescript.ignoreBuildErrors` (per `next.config.ts`), same as the
  Vercel build.

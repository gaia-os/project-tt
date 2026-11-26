# Investment Tech Tree

An interactive visualization platform for exploring energy-technology development pathways, readiness evidence, companies, and investment opportunities. The application is dataset-driven: each seeded MongoDB database becomes a selectable knowledge base, with the current work centered on SMR technology extraction and consensus datasets.

## Project Purpose

The Investment Tech Tree serves as a decision-support tool for investors, researchers, and policymakers. It visualizes dependencies between deployment concepts, enabling technologies, organisations, readiness evidence, and the milestones needed to advance toward commercial energy systems.

The platform includes an edit interface for the technology tree, dataset seeding and merge tooling, AI-powered chat and document analysis through a self-hosted knowledge-graph service, and MongoDB-backed persistence.

## Key Features

### Guided First Visit

- **Welcome flow**: First-time visitors pick a sector, then a deployment
  concept from translucent cards showing TRL, category and prerequisite
  count. "Skip to the full map" is always available, and the picker can be
  reopened from the toolbar or the empty details panel.
- **Guided pathway**: The chosen concept's upstream chain is shown on the
  tree, staged by dependency level. The floating guide steps through each
  stage (←/→ keys, Esc to exit), dims everything else, and ends with links to
  companies, the assistant, another technology, or the full map.
- **Shareable state**: Topic, view, focused node and pathway step live in the
  URL (for example, `?topic=merged&pathway=smr%3Abwrx-300&step=2`).

### Interactive Technology Graph

- **Visual Technology Mapping**: Interactive graph showing deployment/reactor concepts, enabling technologies, and milestones
- **Technology Readiness Levels**: Current and projected TRL tracking for each technology node
- **Relationship Visualization**: Clear depiction of dependencies and connections between technologies
- **Node Highlighting**: Interactive selection with connected element highlighting

### Scaling the Tree Down

- **Aggregate nodes**: "Aggregate" in the toolbar draws each group of nodes
  (by category & role, category, or role) as one summary node with its
  member count, TRL range, role mix and a few member names. Links between
  groups merge into one arrow labelled with how many links it carries.
- **Folding and unfolding**: Clicking an aggregate unfolds it into a framed
  group of its members; the frame's "Fold" button collapses it again, and
  "Unfold all / Fold all" work on every group. Any node whose prerequisites
  feed only into it gets a `−` toggle that folds that branch into the node
  (shown as `+N`). Shared prerequisites are never hidden. The toggled element
  stays in place on screen.
- **Animated folding**: Folds and unfolds morph instead of jumping: nodes
  glide to their new places, unfolded nodes grow out of the node or
  aggregate that held them, folded ones glide back into it, and a frame
  grows out of its aggregate. If an unfold grows past the screen edge, the
  camera glides to show it. Respects "reduce motion".
- **Compare trees**: Puts up to four trees side by side (tech trees and your
  own trees), scaled down to aggregates, with node and link counts, longest
  prerequisite chain, median TRL, mature share, role mix and the TRL
  distribution on shared scales. The first column is the baseline; for trees
  of the same topic an "Overlap with baseline" row counts shared nodes and
  lists the ones only a tree has. "Open aggregated" switches the main view to
  that tree.
- **Zoom all the way out**: The zoom-out limit follows the tree's size, so
  even the largest tree fits on screen, and the first view shows the whole
  tree. Zoomed out, node buttons hide and nodes become role-coloured blocks
  that keep the tree's shape readable.
- **Smooth zooming**: Wheel zoom also works over the panels floating on the
  canvas (tree picker, legend, filters, zoom buttons), and mouse-wheel notches
  glide instead of jumping. Scrollable panels still scroll normally.

### Your Own Trees

- **Build**: "My trees → New tree" (or "From current view") turns on the
  tree builder: click nodes to add or remove them, click an aggregate to take
  its whole group, Shift+drag to pick an area, and grow the selection with
  its prerequisites, dependents or everything the current filters show.
  Give it a name and notes, and save.
- **Quick save**: Save a guided pathway, a connected-nodes view or a
  search/filter result as a tree in one step.
- **Select**: Saved trees appear in the tree picker and under "My trees".
  Opening one shows only its nodes (the URL gets `tree=`), with search,
  filters, aggregation and folding working as usual. Edit, rename,
  duplicate, delete, and export/import them as JSON.
- **Storage**: Trees are kept in this browser (`localStorage`) and store
  only node ids, so they follow later edits to the data; nodes deleted since
  are reported as missing. A `tree=` link only works in the browser that has
  the tree.

### Multi-View Explorer

- **Technology View**: Preserves the dependency graph, simulations, literature
  overlay, voting, paper details, and curation workflow
- **Company View**: Searchable master-detail directory with investment KPIs,
  company profiles, and a compact selected-company technology graph
- **World View**: Pannable/zoomable country map with company-count bubbles,
  verified city pins, and an on-map company/technology drawer
- **Persistent Exploration**: Filters, selection, map pan/zoom, layer, and
  country state survive switching between views

### AI-Powered Chat Interface

- **Contextual Assistance**: Chat is proxied to the kg-service, where the configured Ollama model (`qwen3.8:27b` by default) answers with an agentic loop — it calls KG tools (entity resolution, concept expansion, paper dossiers, vector search over paper chunks, guarded read-only Cypher) and cites papers by id
- **Talks about what you selected**: The chat's context follows the most
  specific selection on screen — the tree being built, a guided pathway
  (with its stages, bottleneck and current step), an open custom tree (with
  your notes), or the whole topic tree. The connected-nodes view and the
  search/category/role filters narrow it further. Selections are sent with
  their prerequisite links. A chip above the input shows what the assistant
  sees, with a switch back to the whole tree.
- **One conversation per context**: The whole tree, each pathway, each
  custom tree and the tree being built keep their own history (saved
  locally; the 30 most recent scoped conversations are kept). A reply that
  arrives after you switch context lands in the conversation it was asked in.
- **Technology Queries**: Ask questions about specific technologies, milestones, or investment opportunities

### Literature Overlay & Curation

- **Literature nodes**: Nodes enriched by the KG show a book icon — papers, devices and findings materialized from Neo4j into MongoDB (`enrich.py`), so no live KG connection is needed at runtime
- **Overview/Focused modes**: Focused mode isolates a node with its literature context; edge labels and kind-colored edges are toggleable
- **Voting**: Users can thumb up/down devices and findings on the nodes, and papers + individual experiments in the paper details modal — tallies surface in the review UI
- **Review Literature**: Admin-gated curation panel — filter by accepted/rejected and manual/AI origin, see vote tallies and LLM rejection reasons, and accept/reject items (including individual paper experiments). Human verdicts persist across enrichment rebuilds.

### Administrative Features

- **Edit Mode**: Password-protected interface for modifying the technology tree
- **CRUD Operations**: Create, read, update, and delete nodes and edges
- **Real-time Updates**: Changes are immediately saved to MongoDB
- **Graph Editing**: Add or remove connections between technologies
- **TRL Management**: Update technology readiness levels based on new evidence

### InFact Analysis Integration

- **Posterior TRL badge**: SMR technology details show the posterior probability for the assessed current TRL next to the TRL band. The displayed value is taken from the final evidence entry, so it represents the largest number of inference steps.
- **Five-level color coding**: 0-19.9% dark red, 20-39.9% light red, 40-59.9% yellow, 60-79.9% light green, and 80-100% dark green.
- **Confidence interval**: a neutral badge shows the lower and upper probability bounds as percentages.
- **Full reports**: `View InFact analysis` opens the complete HTML assessment in a sandboxed modal, including the evidence rationale and belief-evolution chart.
- **MongoDB-backed runtime**: the complete source JSON and HTML report are stored in the dataset database's `infact_analyses` collection. The running application does not read `data/extracted` or the analysis files directly.
- **Per-dataset data**: the pipeline is dataset-specific; currently only the `merged` dataset contains curated InFact outputs. Technologies without an assessment render without the additional badges.

## Technology Stack

### Frontend

- **Next.js 15**: React framework with App Router
- **React 19**: Latest React with concurrent features
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first styling
- **Radix UI**: Accessible component primitives

### Visualization

- **React Flow**: Interactive node-based graph visualization
- **ELK.js**: Automatic graph layout and positioning
- **React Simple Maps / World Atlas**: Local deterministic map rendering
- **Custom Node Types**: Specialized node components for different technology types

### AI Integration

- **kg-service chat**: `/api/chat` streams requests to the self-hosted FastAPI kg-service, which performs a bounded agentic loop over Neo4j and Ollama models
- **Knowledge-grounded answers**: the service can resolve entities, expand concepts, inspect paper dossiers, run vector search, and issue guarded read-only Cypher queries
- **Streaming interface**: chat responses stream as NDJSON with tool/progress events and text deltas
- **Document verification**: PDF uploads are proxied to the kg-service document-verification pipeline
- **Model selection**: available Ollama chat models are configured by the stack and can be switched from the chat settings UI
- **DOMPurify**: sanitizes model-generated HTML before rendering it in the browser

### Development Tools

- **ESLint & Prettier**: Code quality and formatting
- **TypeScript**: Static type checking
- **PostCSS & Autoprefixer**: CSS processing

## Architecture Overview

### Data Structure

MongoDB contains **one database per dataset**. The dataset folder name, MongoDB database name, and topic id are the same identifier (for example, `merged`). Topic discovery is database-first; the selector lists non-system databases that look like seeded tech trees, hiding entries in `EXCLUDED_TOPICS`.

`scripts/seed-dataset.ts` writes these managed collections:

| Collection                | Contents                                                   |
| ------------------------- | ---------------------------------------------------------- |
| `meta`                    | dataset label, chat system prompt, seed timestamp          |
| `nodes`                   | lean graph nodes used by the tree canvas                   |
| `edges`                   | technology/reactor dependency edges                        |
| `node_details`            | rich lazily loaded reactor and technology detail payloads  |
| `infact_analyses`         | full InFact JSON assessments and HTML reports              |
| `images`                  | reactor figures and organisation logos as BSON binary data |
| `tt_companies`            | organisation/company directory records                     |
| `company_tech_tree_edges` | company-to-node `DEVELOPS`/`SUPPLIES` mappings             |
| `tt_company_locations`    | geocoded company locations for the world view              |

Knowledge-graph enrichment is materialized into additional `kg_*` collections (notably `kg_node_enrichment`, `kg_papers`, `kg_curations`, and `kg_votes`) so literature overlays do not require a live Neo4j connection at runtime.

SMR datasets primarily contain reactor concepts (`ReactorConcept`) and enabling technologies (`EnablingTechnology`); older datasets can also contain milestone nodes. InFact documents in `infact_analyses` are keyed by the technology node id and contain the extracted display summary, the complete original JSON under `analysis`, and the complete report under `report_html`.

### Component Architecture

```text
src/
├── app/
│   └── api/                  # Next.js route handlers
│       ├── tech-tree/        # lean graph nodes + edges for a topic
│       ├── topics/           # dataset/topic discovery
│       ├── node-details/     # rich reactor/technology details
│       ├── infact-analysis/  # stored HTML InFact reports
│       ├── nodes|edges/      # admin CRUD operations
│       ├── companies/        # company directory/details
│       ├── company-view/     # company graph and map projection
│       ├── chat|kg/          # chat proxy, literature overlay, voting/curation
│       └── simulation/       # readiness/deployment simulation
├── components/
│   ├── ExplorerWorkspace.tsx # multi-view application shell
│   ├── TechTree.tsx          # interactive graph experience
│   ├── SmrNodeDetails.tsx    # SMR reactor/technology details incl. InFact badges
│   ├── CompanyExplorer.tsx   # company master-detail view
│   ├── WorldExplorer.tsx     # country/company map view
│   ├── Chat.tsx              # streaming KG chat
│   ├── onboarding/           # first-visit concept picker
│   ├── pathway/              # guided prerequisite pathway
│   ├── simulations/          # simulation panels
│   └── ui/                   # reusable Radix/Tailwind primitives
├── hooks/                    # topic, URL, tree-builder, pathway and view state
└── lib/                      # types, graph projection/layout, topic config,
                              # Mongo readers, InFact parsing/ingestion, filters

scripts/                      # dataset seeding/merge and InFact generation utilities
kg/                           # self-hosted app + MongoDB + Neo4j + Ollama stack
tests/                        # node:test unit/projection tests
```

The details panel loads `node_details` lazily instead of putting the full rich payload into the graph response. InFact summaries are joined from `infact_analyses` when technology details are requested; report HTML is fetched only when the report popup is opened.

### State Management

- **React Hooks**: Local component state management
- **URL**: Topic, explorer view, focused node, guided pathway step and open custom tree
- **Local Storage**: Chat conversations (one per context), custom trees, onboarding completion and last topic
- **MongoDB**: Server-side persistent storage for datasets, company projections, InFact analyses, and materialized knowledge-graph data

## Getting Started

### Prerequisites

- Node.js 20+ and npm (Node 22 is used for the production Docker image)
- A reachable MongoDB deployment — either the self-hosted stack in `kg/` or another MongoDB/Atlas-compatible instance
- Docker and Docker Compose for the self-hosted deployment
- Optional for data-generation utilities: Python 3.13 with `uv` (see `pyproject.toml`)

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/gaia-os/project-tt
   cd project-tt
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Create `.env.local`**

   For the server-tunnel workflow, the non-secret structure is:

   ```env
   MONGODB_URI=mongodb://<mongo-user>:<mongo-password>@localhost:33335/?authSource=admin
   KG_SERVICE_URL=http://localhost:33336
   KG_API_KEY=<shared kg-service key>
   ADMIN_PASSWORD=<admin interface password>
   VOTE_SECRET=<long random string>
   EXCLUDED_TOPICS=
   KG_REASONING_DISPLAY=true
   ```

   `.env.local` is gitignored. Do not commit real passwords or keys.

### Environment Variables

| Variable               | Description                                                                                       | Required                |
| ---------------------- | ------------------------------------------------------------------------------------------------- | ----------------------- |
| `MONGODB_URI`          | MongoDB connection string. For server development this normally points at forwarded port `33335`. | Yes                     |
| `ADMIN_PASSWORD`       | Password for tree editing and literature curation.                                                | For admin features      |
| `KG_SERVICE_URL`       | Base URL of the kg-service, normally `http://localhost:33336` through the dev tunnel.             | For chat/model features |
| `KG_API_KEY`           | Shared key sent as `X-API-Key` to the kg-service.                                                 | For chat/model features |
| `VOTE_SECRET`          | HMAC secret signing anonymous literature-voter cookies.                                           | For voting              |
| `EXCLUDED_TOPICS`      | Comma-separated MongoDB database names hidden from the topic selector.                            | No                      |
| `KG_REASONING_DISPLAY` | `true`/`false` server default for showing one-line KG lookup reasons in chat.                     | No                      |
| `INFACT_API_KEY`       | Optional key used only by the local InFact generation scripts, not by the Next.js app.            | No                      |

`NEXT_PUBLIC_ENVIRONMENT` and `GEMINI_API_KEY` are not used by the current application. Chat no longer calls Gemini directly.

### Database Setup

The application does not require Atlas specifically; it only requires a `MONGODB_URI` whose user can read the topic databases. Seeding credentials additionally need write access to those databases. The current reference deployment uses the MongoDB container in `kg/docker-compose.yml`.

For development against the server-hosted SMR stack:

1. Start the SSH forwarding session:

   ```bash
   ./kg/scripts/dev-tunnel.sh <server>
   # or: KG_SERVER=<server> ./kg/scripts/dev-tunnel.sh
   ```

2. Ensure `.env.local` uses the forwarded `localhost:33335` and `localhost:33336` endpoints from the template above.
3. Seed or refresh datasets as needed:

   ```bash
   npm run seed -- <name>          # full dataset seed
   npm run seed:infact -- <name>   # only refresh infact_analyses
   ```

`npm run seed -- <name>` reads `data/extracted/<name>/` and replaces the managed collections in MongoDB database `<name>`. Use `DRY_RUN=true` to inspect the parse counts without writing, `SKIP_GEOCODE=true` to avoid uncached Nominatim requests, and `MONGODB_DB_NAME=<other-name>` when seeding into a test database. `npm run seed:infact -- <name>` is the targeted InFact refresh: it leaves other collections untouched, updates only `infact_analyses`, and requires the dataset's `node_details` collection to exist.

### Run the App

1. **Start the development server**

   ```bash
   npm run dev
   ```

2. **Open the application**

   Open <http://localhost:3000/investment-tech-tree>. The `/investment-tech-tree` base path is intentional and comes from `next.config.ts`.

## Development

### Available Scripts

- `npm run dev` — start the Next.js development server
- `npm run build` — create the production build
- `npm run start` — start the production server
- `npm run lint` — run ESLint
- `npm run typecheck` — run strict TypeScript checks
- `npm test` — run all `node:test` unit and projection tests
- `npm run seed -- <dataset>` — seed `data/extracted/<dataset>` into the matching MongoDB database
- `npm run seed:infact -- <dataset>` — refresh only the dataset's derived `infact_analyses` collection

### Make Shortcuts

`make help` is the authoritative target list. The targets relevant to the current server workflow are:

- `make check` — lint, typecheck, and unit tests
- `make build` — production build
- `make tunnel SERVER=user@host` — forward the server's MongoDB, kg-service, and Neo4j ports for local development
- `make stack-up` / `make stack-down` / `make stack-logs` — manage the full `kg/` Docker Compose stack on a Linux GPU host

The older local app/Mongo targets are for the legacy `data/*.json` nuclear/fossil workflow; several still reference removed scripts and are not part of the current dataset workflow. For folder-based extracted datasets, use the explicit `npm run seed -- <dataset>` workflow documented here.

### Remote Services via SSH Port Forwarding

The SMR server stack publishes MongoDB, Neo4j, kg-service, and the app on the server's loopback. For workstation development, use the repository script:

```bash
./kg/scripts/dev-tunnel.sh <server>
# or
KG_SERVER=<server> ./kg/scripts/dev-tunnel.sh
```

It forwards these ports while the SSH session remains open:

| Local port | Service       | Use                                                     |
| ---------- | ------------- | ------------------------------------------------------- |
| `33335`    | MongoDB       | `MONGODB_URI`, seed scripts, direct database inspection |
| `33336`    | kg-service    | `KG_SERVICE_URL`, chat and model switching              |
| `33333`    | Neo4j Browser | optional graph debugging                                |
| `33334`    | Neo4j Bolt    | optional graph debugging                                |

A MongoDB URI for this setup has the form `mongodb://<mongo-user>:<mongo-password>@localhost:33335/?authSource=admin`; chat uses `KG_SERVICE_URL=http://localhost:33336`. Ollama does not need to be forwarded for normal app development because the kg-service runs beside it on the server. The literature overlay also needs no live Neo4j connection because it reads materialized `kg_*` collections from MongoDB.

### Data Management

Runtime data is stored in MongoDB — in the current reference deployment, the self-hosted MongoDB container. Folders under `data/extracted/` are ingestion inputs, not runtime dependencies.

**Using the Edit Interface:**

- Click "Edit Tree" in the main interface
- Enter the admin password (set in `ADMIN_PASSWORD`)
- Add or edit nodes and edges; deleting a node also removes connected edges
- Changes are saved immediately to MongoDB

**Using AI assistance:**

- Upload PDF research papers or technical documents in the main chat for document analysis
- Model output never edits the tree automatically; review it critically and apply accepted changes manually through the edit interface

#### InFact generation and ingestion

The ingestion pipeline consumes InFact output from the dataset folder. The generation scripts are separate from the web runtime and require Python/`uv` plus a reachable local InFact API at `http://127.0.0.1:8007`:

```bash
uv run scripts/infact/check_node_refs.py merged
uv run scripts/infact/analyze_all_nodes.py --db merged
uv run scripts/infact/render_reports.py
```

`analyze_all_nodes.py` writes JSON assessments beneath `outputs/node-infact-details/`; `render_reports.py` writes the companion HTML files there. See `scripts/infact/infact_doc.md` for the chained evidence/API semantics. Stage the resulting pairs in the dataset-specific layout expected by the seeder:

```text
data/extracted/<dataset>/
└── infact-smr-analysis/
    ├── node-infact-results.csv              # optional summary/provenance
    └── nodes/
        └── node-infact-details/
            ├── <node-slug>.json
            └── <node-slug>.html
```

For example, after a generation run:

```bash
mkdir -p data/extracted/<dataset>/infact-smr-analysis/nodes/node-infact-details
cp outputs/node-infact-details/*.json outputs/node-infact-details/*.html \
  data/extracted/<dataset>/infact-smr-analysis/nodes/node-infact-details/
cp outputs/node-infact-results.csv data/extracted/<dataset>/infact-smr-analysis/   # optional
```

The HTML reports load Chart.js from `cdn.jsdelivr.net`; the report API permits that CDN in its content-security policy, so browser access to the CDN is needed for the belief-evolution chart.

The generator's node slug is the lowercased technology label with spaces and `/` replaced by `-` (other characters such as parentheses and `&` are retained). Ingestion nevertheless matches assessments by the JSON `node_label`, not by filename alone; the companion HTML must use the same slug basename.

Then ingest them into that dataset's MongoDB database:

```bash
npm run seed:infact -- <dataset>
```

The targeted seeder validates each JSON payload, matches `node_label` exactly to an existing technology name, reports and skips invalid/unmatched/duplicate inputs, stores the complete JSON and companion HTML in `infact_analyses`, upserts current documents, and removes stale documents only from that derived collection. A full `npm run seed -- <dataset>` also includes the same ingestion step, but replaces all managed dataset collections; if the optional InFact folder is absent, the full seed writes an empty `infact_analyses` collection.

### Code Quality

The project uses automated code quality tools:

- **ESLint**: JavaScript/TypeScript linting
- **Prettier**: Code formatting
- **lint-staged**: Pre-commit hooks for code quality

## Deployment

### Self-hosted SMR stack (current reference deployment)

The production deployment is the Docker Compose stack in `kg/`: Next.js app, MongoDB, Neo4j, Ollama, and kg-service on one internal network. See `kg/README.md` for the complete stack documentation.

First deployment on the server:

```bash
cd kg
cp env.example .env   # fill in the secrets and machine-specific values
docker compose up -d --build
curl localhost:33336/health
curl localhost:33337/investment-tech-tree
```

The compose file binds published host ports to `127.0.0.1` by default. Reach them through SSH forwarding or put the app behind an explicitly configured reverse proxy; do not expose MongoDB or Neo4j publicly.

For a one-off Atlas-to-container MongoDB migration, set `MONGODB_SOURCE_URI` in `kg/.env` and run:

```bash
cd kg
MIGRATE_DBS="merged" ./scripts/mongo-migrate.sh
```

`MIGRATE_DBS` accepts a space-separated database list and defaults to `smr`. New or updated extraction folders can alternatively be seeded through the SSH tunnel with `npm run seed -- <dataset>`.

### Local production build

A production build can also be run directly when `.env.local` points at a reachable MongoDB/kg-service:

```bash
npm run build
npm run start
```

The application uses dynamic API routes and MongoDB, so it is **not** a static-export application; there is no complete static `out/` deployment.

### External hosting note

Vercel or another external Node.js host can still run the Next.js app, but only when both MongoDB and the kg-service are reachable over the network. Configure `MONGODB_URI`, `ADMIN_PASSWORD`, `VOTE_SECRET`, `KG_SERVICE_URL`, `KG_API_KEY`, and optionally `EXCLUDED_TOPICS` / `KG_REASONING_DISPLAY`. The current reference deployment is nevertheless the self-hosted `kg/` Compose stack, because it colocates the database, graph service, and Ollama models.

## Mobile support

The application is optimized for desktop and tablet devices. Mobile phone users will see a warning dialog recommending desktop usage for the best experience. However, the application is functional on mobile with responsive adaptations:

- Toggle buttons for showing/hiding legend and options
- Collapsible panels and controls
- Touch-friendly interface elements
- Simplified navigation

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run linting and tests
5. Submit a pull request

## Adding a New Dataset

Datasets are folder-driven: drop an extracted knowledge base into `data/extracted/<name>/` and seed it. `data/extracted/` is gitignored, so dataset contents are transferred or generated outside git. Use only letters, digits, `-`, and `_` in `<name>`; it becomes both the MongoDB database name and the topic id.

### 1. Prepare the data folder

Required and optional inputs:

```text
data/extracted/<name>/
├── technologies/
│   ├── graph.json              # required: nodes + typed edges
│   └── *.md                    # Technology entities with YAML frontmatter
├── reactors/*.md               # SMRDesign entities, when the dataset has reactors
├── orgs/*.md                   # Organisation entities
├── dataset.json                # optional label and chat system prompt
└── infact-smr-analysis/        # optional InFact assessments
    └── nodes/node-infact-details/*.json + *.html
```

Example `dataset.json`:

```json
{
  "label": "SMRs (merged consensus)",
  "systemPrompt": "You are an expert in small modular reactors..."
}
```

Raw source folders such as `iaea-aris/` or `nea/` can remain in the dataset directory for provenance, but the seeder reads the normalized markdown and `technologies/graph.json` inputs described above.

### 2. Inspect and seed

```bash
DRY_RUN=true SKIP_GEOCODE=true npm run seed -- <name>
npm run seed -- <name>
```

The dry run reports node, edge, detail, image, company, location, and InFact counts without touching MongoDB. A real seed replaces the managed collections in database `<name>`; use `MONGODB_DB_NAME=<test-name>` to rehearse into a separate database. Geocoded headquarters are cached in `<name>/.geocode-cache.json`, with `SKIP_GEOCODE=true` disabling new Nominatim requests.

If the dataset already exists in MongoDB and only the InFact files changed, use the targeted refresh instead:

```bash
npm run seed:infact -- <name>
```

### 3. Check topic discovery and rendering

No topic configuration file is needed: `data/extracted/<name>` ↔ MongoDB `<name>` ↔ selector entry `<name>`. After seeding, the app discovers the database through MongoDB and displays the label from `dataset.json`.

The standard graph roles (`ReactorConcept`, `Milestone`, and `EnablingTechnology`) already have styling. If a dataset introduces a new node `type`, update the node-label and color mappings in `src/lib/types.ts` and the related display logic.

### 4. Optional graph comparison/merge workflow

For consensus datasets built from multiple extraction runs, the repository includes:

```bash
python scripts/compare_graphs.py data/extracted/run-a data/extracted/run-b --out outputs/graph-comparison
python scripts/merge_graphs.py data/extracted/run-a data/extracted/run-b --out data/extracted/merged --label "SMRs (merged)"
```

`compare_graphs.py` writes structural reports and CSV differences. `merge_graphs.py` requires PyYAML and produces a complete dataset folder that can be seeded with the same `npm run seed -- <name>` workflow; review `review-candidates.csv` / `approved-matches.csv` when reconciling fuzzy entity matches.

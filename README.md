# Investment Tech Tree

An interactive visualization platform for exploring energy technology development pathways and investment opportunities. This web application provides a comprehensive view of various energy sectors - including Nuclear (fusion and fission), Fossil Fuels and their enabling technologies, core concepts, and key milestones.

## Project Purpose

The Investment Tech Tree serves as a decision-support tool for investors, researchers, and policymakers in the nuclear energy sector. It visualizes the complex relationships between different technologies, their current Technology Readiness Levels (TRL), and the critical milestones needed to advance toward commercial nuclear power.

The platform features a full CRUD interface for editing the technology tree, AI-powered document analysis for suggesting improvements, and integration with MongoDB for persistent data storage.

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
  URL (`?topic=nuclear&pathway=concept_hts_tokamak&step=2`).

### Interactive Technology Graph

- **Visual Technology Mapping**: Interactive graph showing fusion reactor concepts, enabling technologies, and milestones
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

- **Contextual Assistance**: Chat is proxied to the kg-service, where `qwen3.8:27b` (Ollama) answers with an agentic loop — it calls KG tools (entity resolution, concept expansion, paper dossiers, vector search over paper chunks, guarded read-only Cypher) and cites papers by id
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

- **Literature nodes**: Nodes enriched by the KG show a book icon — papers, fusion devices and findings materialized from Neo4j into MongoDB (`enrich.py`), so no live KG connection is needed at runtime
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

- **TRL Verification**: Automated analysis of technology readiness levels
- **Uncertainty Metrics**: Probability and uncertainty measurements for TRL assessments
- **Detailed Reports**: Full analysis reports with evidence and interpretation
- **Interactive Visualization**: View complete analysis in embedded HTML reports


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

- **Google Gemini API**: Advanced language model for contextual assistance (currently in use; migrating to self-hosted `qwen3.8:27b` via Ollama)
- **DOMPurify**: XSS protection for AI-generated content
- **Rate Limiting**: Client-side request management
- **PDF Processing**: Support for uploading and analyzing PDF documents

### Development Tools

- **ESLint & Prettier**: Code quality and formatting
- **TypeScript**: Static type checking
- **PostCSS & Autoprefixer**: CSS processing

## Architecture Overview

### Data Structure

The application uses MongoDB Atlas for persistent data storage with three main node types:

1. **Reactor Concepts**: Core fusion reactor designs (Tokamak, Stellarator, FRC, ICF)
2. **Milestones**: Critical achievements and demonstrations
3. **Enabling Technologies**: Supporting technologies and components

Each node includes:

- Technology Readiness Level (TRL) tracking
- Detailed descriptions and context
- Category and subtype classification
- Projected development timelines
- References and citations
- InFact analysis results (when available)

### Component Architecture

```
src/
├── app/                 # Next.js App Router pages
│   ├── api/            # API routes for data operations
│   │   ├── tech-tree/  # Fetch all nodes and edges
│   │   ├── nodes/      # CRUD operations for nodes
│   │   └── edges/      # CRUD operations for edges
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/          # React components
│   ├── ui/             # Reusable UI components
│   ├── TechTree.tsx    # Main graph visualization
│   ├── Chat.tsx        # AI chat interface
│   ├── NodeDetails.tsx # Node information display
│   ├── TabPanel.tsx    # Tabbed interface for chat/details/simulations
│   ├── EditInterface.tsx        # Edit mode wrapper
│   ├── EditTechTreePanel.tsx    # CRUD interface for editing
│   ├── AiAssistantPanel.tsx     # Specialized AI for document analysis and edit suggestions
│   ├── GroupSelector.tsx        # Graph grouping and filtering
│   ├── CustomNode.tsx           # Custom node rendering (with branch fold toggle)
│   ├── AggregateNode.tsx        # One node standing for a whole group
│   ├── GroupFrameNode.tsx       # Frame around an unfolded group
│   ├── TreeComparison.tsx       # "Compare trees" dialog (topics and custom trees)
│   ├── AnimatedReactFlow.tsx    # React Flow plus animated relayouts
│   ├── TreeBuilderPanel.tsx     # Floating card for building a custom tree
│   ├── BoxSelection.tsx         # Shift+drag area pick while building
│   ├── SaveTreeDialog.tsx       # Save a pathway/view as a custom tree
│   ├── MyTreesDialog.tsx        # List and manage custom trees
│   ├── techTreeNodeTypes.tsx    # Stable React Flow node types (context-driven)
│   ├── NodeActions.tsx          # Node action buttons
│   ├── Legend.tsx               # Graph legend
│   ├── MobileWarning.tsx        # Mobile device warning
│   ├── LoadingSpinner.tsx       # Loading state
│   ├── onboarding/              # Welcome flow (sector and technology cards)
│   └── pathway/                 # Guided pathway floating guide
├── hooks/              # Custom React hooks
│   ├── useTechTree.ts           # Shared, de-duplicated tech tree fetch
│   ├── useExplorerUrlState.ts   # Topic/view/focus/pathway/step in the URL
│   ├── useCanvasWheel.ts        # Wheel zoom over canvas panels, smoothed notches
│   ├── useCustomTrees.ts        # Shared store of custom trees (localStorage)
│   ├── useTreeBuilder.ts        # Draft state of the tree being built
│   └── usePathwayMode.ts        # Pathway subgraph and guide steps
├── lib/                # Utility libraries
│   ├── types.ts        # TypeScript type definitions
│   ├── pathway.ts      # Upstream pathway staging and guide steps
│   ├── technologyCatalog.ts # Picker cards for deployment concepts
│   ├── onboardingStorage.ts # First-visit flag and last topic
│   ├── deploymentEstimate.ts # Shared scheduler estimate
│   ├── treeProjection.ts # Aggregation, branch folding and tree summaries
│   ├── canvasZoom.ts   # Size-based zoom-out limit and zoom detail levels
│   ├── layoutTransition.ts # Plans and interpolates relayout animations
│   ├── customTrees.ts  # Custom tree model, storage format, graph helpers
│   ├── chatContext.ts  # Chat scope, request payload and context text
│   ├── chatThreadStorage.ts # One stored conversation per chat context
│   ├── elkjs.ts        # Graph layout engine (incl. frames for unfolded groups)
│   ├── mongodb.ts      # MongoDB connection
│   └── utils.ts        # Utility functions
```

### State Management

- **React Hooks**: Local component state management
- **URL**: Topic, explorer view, focused node, guided pathway step and open custom tree
- **Local Storage**: Chat conversations (one per context), custom trees, onboarding completion and last topic
- **MongoDB**: Server-side persistent storage for all tech tree data

## Getting Started

### Prerequisites

- Node.js 18+ (<https://nodejs.org/en/download>)
- npm or yarn package manager
- MongoDB Atlas Account (https://www.mongodb.com/cloud/atlas)

### Database Setup

- Sign up at https://www.mongodb.com/cloud/atlas
- Create a new free cluster
- Note your cluster connection details
- Each dataset lives in `data/extracted/<name>/` and is seeded into the
  MongoDB database `<name>`:
  `npx tsx --env-file=.env.local scripts/seed-dataset.ts <name>`
  (or `npm run seed -- <name>`). The app's tree selector lists every seeded
  database. An optional `dataset.json` in the folder sets the display label
  and chat system prompt.

### Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd gaia-tt
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Environment Setup**
   Create a `.env.local` file in the project root:

   ```env
   NEXT_PUBLIC_ENVIRONMENT=development
   MONGODB_URI=your_tech_tree_db_connection_string
   ADMIN_PASSWORD=your_admin_password_here
   KG_SERVICE_URL=http://localhost:8080   # kg-service (chat), e.g. forwarded 22333
   KG_API_KEY=your_shared_kg_service_key
   VOTE_SECRET=any_long_random_string     # signs anonymous voter cookies
   ```

4. **Start development server**

   ```bash
   npm run dev
   ```

5. **Access the application**
   Open <http://localhost:3000/investment-tech-tree> in your browser

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_ENVIRONMENT` | Environment mode (development/production) | Yes |
| `MONGODB_URI` | Connection string for DB | Yes |
| `ADMIN_PASSWORD` | Admin PWD for TT Edits and literature curation | Yes |
| `KG_SERVICE_URL` | Base URL of the kg-service (chat backend), e.g. `http://localhost:22333` | For chat |
| `KG_API_KEY` | Shared key sent as `X-API-Key` to the kg-service | For chat |
| `VOTE_SECRET` | HMAC key signing anonymous voter cookies (any long random string) | For voting |
| `GEMINI_API_KEY` | Legacy — chat now uses the kg-service; safe to drop | No |

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run typecheck` - Run strict TypeScript checks
- `npm test` - Run Company/World projection and geography tests
- `npm run audit:data` - Validate active graph, company mapping, and location data
- `npm run generate:company-locations` - Regenerate verified city coordinates
  from headquarters text using the local GeoNames gazetteer

### Make Shortcuts

`make help` lists everything. The common ones:

- `make ready` - install dependencies, create `.env.local` if missing, start
  MongoDB (`gaia-tt-mongo` on port 27017) and seed any empty database
- `make dev` - start MongoDB and the dev server at
  `http://localhost:3000/investment-tech-tree`
- `make up` / `make down` - build and run the production image
  (`gaia-tt-app`) with MongoDB, or stop both; `make logs` follows the app
- `make check` - lint, typecheck and unit tests
- `make db-status` - node, edge and company counts per database
- `make seed` - reload nodes and edges from `data/*.json` (replaces admin edits)

Chat needs the kg-service; on a workstation use `make tunnel SERVER=user@host`
and set `KG_SERVICE_URL`/`KG_API_KEY` in `.env.local`. The `stack-*` targets
run the full `kg/` stack and need a Linux host with an NVIDIA GPU.

### Remote Services via SSH Port Forwarding

For local development, the knowledge-graph backend services (Neo4j and Ollama) run on the remote `aconcagua` host on non-standard ports. Forward them to their standard local ports so local tools and services can reach them on `localhost`:

```bash
ssh -L 7474:localhost:7475 -L 7687:localhost:7688 -L 11434:localhost:11437 -L 22333:localhost:22333 <host>
```

| Local port | Service | Remote port (`aconcagua server`) |
|------------|---------|---------------------|
| 7474 | Neo4j Browser (HTTP) | 7475 |
| 7687 | Neo4j Bolt | 7688 |
| 11434 | Ollama API | 11437 |
| 22333 | kg-service API | 22333 |

Keep the SSH session open while developing. You can verify the Ollama endpoint with `scripts/check_ollama.sh`.

> **Note on LLMs:** Chat is served by the kg-service (`fusion_kg_builder` repo, `service/kg_service.py` — FastAPI + bounded agentic loop over `qwen3.8:27b` on Ollama, with KG tools incl. read-only Cypher and vector search). For chat-only use, forwarding `22333` suffices and `KG_SERVICE_URL=http://localhost:22333`. The literature overlay does not need any forwarding — it reads materialized `kg_*` collections from MongoDB.

### Code Quality

The project uses automated code quality tools:

- **ESLint**: JavaScript/TypeScript linting
- **Prettier**: Code formatting
- **lint-staged**: Pre-commit hooks for code quality

### Data Management

All technology tree data is stored in MongoDB Atlas. To modify the tech tree:

**Using the Edit Interface:**
   - Click "Edit Tree" in the main interface
   - Enter the admin password (set in `ADMIN_PASSWORD`)
   - Use the edit interface to:
     - Add new nodes with required connections
     - Edit existing node properties
     - Delete nodes (removes connected edges automatically)
     - Add or remove edges between nodes
   - Changes are saved immediately to MongoDB

**Using the AI Assistant:**
   - Upload research papers or technical documents
   - AI analyzes content and suggests additions/modifications
   - Review suggestions and manually apply via Edit Interface

## Deployment

### Build for Production

```bash
npm run build
npm run start
```

### Static Export

The application can be exported as static files:

```bash
npm run build
# Static files will be in the 'out' directory
```

## Mobile support

The application is optimized for desktop and tablet devices. Mobile phone users will see a warning dialog recommending desktop usage for the best experience. However, the application is functional on mobile with responsive adaptations:

- Toggle buttons for showing/hiding legend and options
- Collapsible panels and controls
- Touch-friendly interface elements
- Simplified navigation


### Deploying to Vercel

1. Push your code to GitHub
2. Import project in Vercel
3. Configure environment variables:
   - `MONGODB_URI`
   - `ADMIN_PASSWORD`
   - `VOTE_SECRET`
   - `KG_SERVICE_URL` / `KG_API_KEY` — point at the tunneled kg-service (see `docker-compose.stack.yml` in the `fusion_kg_builder` repo; the service publishes `22333` on the KG server's loopback)
   - `NEXT_PUBLIC_ENVIRONMENT=production`
4. Deploy

The application will be available at your Vercel domain with the `/investment-tech-tree` base path.


## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run linting and tests
5. Submit a pull request

## Adding a New Dataset

Datasets are folder-driven: drop an extracted knowledge base into
`data/extracted/<name>/` and seed it — no code changes needed.

1. **Prepare the Data Folder**
   - Create `data/extracted/<name>/` with the same layout as `data/extracted/smr/`:
     - `technologies/graph.json` — nodes + typed edges (required)
     - `reactors/*.md`, `technologies/*.md`, `orgs/*.md` — entities with YAML frontmatter
     - optional `dataset.json` — `{ "label": "...", "systemPrompt": "..." }` for the
       selector label and chat prompt (defaults to the folder name + a generic prompt)

2. **Seed the Database**
   ```bash
   npx tsx --env-file=.env.local scripts/seed-dataset.ts <name>
   ```
   The folder name becomes the MongoDB database name. The app discovers the new
   dataset automatically — it appears in the tree selector without a redeploy.

3. **Update Node Types and Styling (`src/lib/types.ts`)**
   - Add new node types to `NODE_LABELS` (e.g., `SolarConcept`).
   - Assign Tailwind CSS color classes in `LABEL_COLORS`.
   - Add corresponding entries to `LABEL_COLORS_VARIABLES` so they render correctly.

4. **Topic Configuration**
   - None needed — `data/extracted/<name>` ↔ MongoDB `<name>` ↔ selector entry
     `<name>` are all the same identifier. Labels/prompts come from `dataset.json`.
   - If you introduce new node `type` values, also update `NODE_LABELS` /
     `LABEL_COLORS` in `src/lib/types.ts` so they render correctly.

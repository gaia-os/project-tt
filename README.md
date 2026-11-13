# Investment Tech Tree

An interactive visualization platform for exploring energy technology development pathways and investment opportunities. This web application provides a comprehensive view of various energy sectors - including Nuclear (fusion and fission), Fossil Fuels and their enabling technologies, core concepts, and key milestones.

## Project Purpose

The Investment Tech Tree serves as a decision-support tool for investors, researchers, and policymakers in the nuclear energy sector. It visualizes the complex relationships between different technologies, their current Technology Readiness Levels (TRL), and the critical milestones needed to advance toward commercial nuclear power.

The platform features a full CRUD interface for editing the technology tree, AI-powered document analysis for suggesting improvements, and integration with MongoDB for persistent data storage.

## Key Features

### Interactive Technology Graph

- **Visual Technology Mapping**: Interactive graph showing fusion reactor concepts, enabling technologies, and milestones
- **Technology Readiness Levels**: Current and projected TRL tracking for each technology node
- **Relationship Visualization**: Clear depiction of dependencies and connections between technologies
- **Node Highlighting**: Interactive selection with connected element highlighting

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
- **Technology Queries**: Ask questions about specific technologies, milestones, or investment opportunities
- **Persistent History**: Chat history saved locally for continuity

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
│   ├── CustomNode.tsx           # Custom node rendering
│   ├── NodeActions.tsx          # Node action buttons
│   ├── Legend.tsx               # Graph legend
│   ├── MobileWarning.tsx        # Mobile device warning
│   └── LoadingSpinner.tsx       # Loading state
├── hooks/              # Custom React hooks
│   └── useTechTree.ts  # Hook for fetching tech tree data
├── lib/                # Utility libraries
│   ├── types.ts        # TypeScript type definitions
│   ├── elkjs.ts        # Graph layout engine
│   ├── geminiClient.ts # AI client integration
│   ├── mongodb.ts      # MongoDB connection
│   └── utils.ts        # Utility functions
```

### State Management

- **React Hooks**: Local component state management
- **Local Storage**: Persistent chat history and user preferences
- **Context API**: Shared state for graph interactions
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

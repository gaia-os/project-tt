# Shortcuts for local development and the Docker containers.
# Run `make` (or `make help`) to list the targets.
#
# Written for the GNU Make 3.81 that ships with macOS: recipes are
# tab-indented and avoid newer features such as .ONESHELL.

SHELL := /bin/bash

APP_IMAGE       ?= investment-tech-tree
APP_CONTAINER   ?= gaia-tt-app
APP_PORT        ?= 3000
MONGO_CONTAINER ?= gaia-tt-mongo
MONGO_IMAGE     ?= mongo:7
MONGO_VOLUME    ?= gaia-tt-mongo-data
MONGO_PORT      ?= 27017
NETWORK         ?= gaia-tt-net
ENV_FILE        ?= .env.local
APP_URL         := http://localhost:$(APP_PORT)/investment-tech-tree
STACK           := docker compose -f kg/docker-compose.yml

# Backslash-newlines inside recipes reach the shell verbatim, which would
# break inline JavaScript; in a variable they collapse to spaces.
DB_STATUS_JS := ["nuclear_tt_db", "fossil_fuels_tt_db", "smr_tt_db"].forEach((name) => { \
	const d = db.getSiblingDB(name); \
	print(name.padEnd(20), "nodes", d.nodes.countDocuments(), \
		" edges", d.edges.countDocuments(), \
		" companies", d.tt_companies.countDocuments()); \
	});

.DEFAULT_GOAL := help

.PHONY: help ready dev up down restart logs status \
	test lint typecheck check audit build \
	mongo-up mongo-down mongo-shell db-status seed seed-if-empty \
	app-build app-run app-down \
	stack-up stack-down stack-logs tunnel \
	install clean docker-check network

##@ Everyday

help: ## List the targets
	@awk 'BEGIN { FS = ":.*## " } \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } \
		/^[a-zA-Z0-9_-]+:.*## / { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo

ready: install $(ENV_FILE) mongo-up seed-if-empty ## First-time setup: dependencies, env file, MongoDB with data
	@echo "Ready. Next: 'make dev' (hot reload) or 'make up' (production container)."

dev: install $(ENV_FILE) mongo-up ## Run the Next.js dev server against local MongoDB
	@echo "Open $(APP_URL)"
	npm run dev -- --port $(APP_PORT)

up: mongo-up app-build app-run ## Build and start the app container plus MongoDB

down: app-down mongo-down ## Stop the app container and MongoDB

restart: down up ## Stop everything, rebuild and start again

logs: ## Follow the app container logs
	docker logs -f $(APP_CONTAINER)

status: ## Show the app and MongoDB containers
	@docker ps -a --filter name=$(APP_CONTAINER) --filter name=$(MONGO_CONTAINER) \
		--format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

##@ Checks

test: install ## Run the unit tests
	npm test

lint: install ## Run ESLint
	npm run lint

typecheck: install ## Run the TypeScript compiler without emitting
	npm run typecheck

check: lint typecheck test ## Lint, typecheck and test

audit: install ## Validate the source datasets in data/
	npm run audit:data

build: install ## Production build (stop 'make dev' first; both use .next)
	npm run build

##@ Database

mongo-up: docker-check network ## Start MongoDB on localhost:27017 (creates it on first run)
	@if docker container inspect $(MONGO_CONTAINER) >/dev/null 2>&1; then \
		docker start $(MONGO_CONTAINER) >/dev/null; \
	else \
		echo "Creating $(MONGO_CONTAINER) with volume $(MONGO_VOLUME)"; \
		docker run -d --name $(MONGO_CONTAINER) -p $(MONGO_PORT):27017 \
			-v $(MONGO_VOLUME):/data/db $(MONGO_IMAGE) >/dev/null; \
	fi
	@# Without a restart policy it stays stopped after Docker Desktop restarts.
	@docker update --restart unless-stopped $(MONGO_CONTAINER) >/dev/null
	@docker network connect $(NETWORK) $(MONGO_CONTAINER) 2>/dev/null || true
	@printf "Waiting for MongoDB"; \
	for i in $$(seq 1 30); do \
		if docker exec $(MONGO_CONTAINER) mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' >/dev/null 2>&1; then \
			echo " ready on localhost:$(MONGO_PORT)"; exit 0; \
		fi; \
		printf "."; sleep 1; \
	done; \
	echo " timed out"; exit 1

mongo-down: ## Stop MongoDB (data is kept)
	@docker stop $(MONGO_CONTAINER) >/dev/null 2>&1 || true
	@echo "Stopped $(MONGO_CONTAINER)"

mongo-shell: mongo-up ## Open mongosh inside the MongoDB container
	docker exec -it $(MONGO_CONTAINER) mongosh

db-status: mongo-up ## Show node, edge and company counts per database
	@docker exec $(MONGO_CONTAINER) mongosh --quiet --eval '$(DB_STATUS_JS)'

seed: install $(ENV_FILE) mongo-up ## Reload nuclear and fossil nodes/edges from data/*.json (YES=1 skips the prompt)
	@if [ "$(YES)" != "1" ]; then \
		read -r -p "This replaces all nodes and edges in nuclear_tt_db and fossil_fuels_tt_db, including admin edits. Continue? [y/N] " answer; \
		[ "$$answer" = "y" ] || { echo "Cancelled"; exit 1; }; \
	fi
	npx tsx --env-file=$(ENV_FILE) scripts/add-nuclear-data.ts
	npx tsx --env-file=$(ENV_FILE) scripts/add-fossil-fuel-data.ts

seed-if-empty: install $(ENV_FILE) mongo-up ## Seed only the databases that have no nodes yet
	@for pair in nuclear_tt_db:add-nuclear-data fossil_fuels_tt_db:add-fossil-fuel-data; do \
		db=$${pair%%:*}; script=$${pair##*:}; \
		count=$$(docker exec $(MONGO_CONTAINER) mongosh --quiet --eval "db.getSiblingDB('$$db').nodes.countDocuments()"); \
		if [ "$${count:-0}" -eq 0 ]; then \
			echo "$$db is empty, seeding from data/"; \
			npx tsx --env-file=$(ENV_FILE) scripts/$$script.ts || exit 1; \
		else \
			echo "$$db already has $$count nodes, skipping"; \
		fi; \
	done

##@ App container

app-build: docker-check ## Build the production image
	docker build -t $(APP_IMAGE) .

app-run: docker-check $(ENV_FILE) network ## Start the built image (needs mongo-up)
	@docker rm -f $(APP_CONTAINER) >/dev/null 2>&1 || true
	@# The container reaches MongoDB by name on the shared network, so the
	@# localhost URI from the env file is dropped; a localhost kg-service URL
	@# (an SSH tunnel) is pointed at the host instead.
	@docker run -d --name $(APP_CONTAINER) --network $(NETWORK) -p $(APP_PORT):3000 \
		--env-file <(sed -E \
			-e '/^[[:space:]]*(#|$$)/d' \
			-e '/^MONGODB_URI=/d' \
			-e "s/^([A-Za-z_][A-Za-z0-9_]*)=[\"'](.*)[\"']$$/\1=\2/" \
			-e 's#^(KG_SERVICE_URL=https?://)(localhost|127\.0\.0\.1)#\1host.docker.internal#' \
			$(ENV_FILE)) \
		-e MONGODB_URI=mongodb://$(MONGO_CONTAINER):27017 \
		$(APP_IMAGE) >/dev/null
	@printf "Waiting for the app"; \
	for i in $$(seq 1 30); do \
		if curl -fs -o /dev/null $(APP_URL); then echo " ready: $(APP_URL)"; exit 0; fi; \
		printf "."; sleep 1; \
	done; \
	echo " not responding, check 'make logs'"; exit 1

app-down: ## Stop and remove the app container
	@docker rm -f $(APP_CONTAINER) >/dev/null 2>&1 || true
	@echo "Stopped $(APP_CONTAINER)"

##@ Server stack (Linux host with an NVIDIA GPU, see kg/README.md)

stack-up: ## Start app, MongoDB, Neo4j, Ollama and kg-service (needs kg/.env)
	$(STACK) up -d --build

stack-down: ## Stop the server stack
	$(STACK) down

stack-logs: ## Follow the server stack logs
	$(STACK) logs -f --tail=100

tunnel: ## Forward the server's MongoDB, kg-service and Neo4j here (SERVER=user@host)
	@test -n "$(SERVER)" || { echo "Usage: make tunnel SERVER=user@host"; exit 1; }
	./kg/scripts/dev-tunnel.sh $(SERVER)

##@ Housekeeping

install: node_modules ## Install npm dependencies when package-lock.json changes

clean: ## Remove the Next.js build output
	rm -rf .next

node_modules: package-lock.json
	npm ci
	@touch node_modules

$(ENV_FILE):
	@echo "Creating $(ENV_FILE) for local MongoDB"
	@{ \
		echo "MONGODB_URI=mongodb://127.0.0.1:$(MONGO_PORT)"; \
		echo "ADMIN_PASSWORD=change-me"; \
		echo "VOTE_SECRET=$$(openssl rand -hex 24)"; \
	} > $(ENV_FILE)

docker-check:
	@docker info >/dev/null 2>&1 || { echo "Docker is not running. Start Docker Desktop first."; exit 1; }

network: docker-check
	@docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK) >/dev/null

# Next.js app image for the smr stack (kg/docker-compose.yml).
# Produces a slim runtime via `output: 'standalone'` in next.config.ts.
#
#   docker build -t investment-tech-tree .
#
# Runtime env (set by compose): MONGODB_URI, KG_SERVICE_URL, KG_API_KEY,
# ADMIN_PASSWORD, VOTE_SECRET. Build needs no secrets — MONGODB_URI is read
# lazily in API routes, not at build time.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
# App is served under the /investment-tech-tree basePath.
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
  CMD wget -qO /dev/null http://localhost:3000/investment-tech-tree || exit 1

CMD ["node", "server.js"]

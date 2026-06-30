# syntax=docker/dockerfile:1

# Sentinelle ships as a single container that serves the admin dashboard at
# /admin and the JSON/WebSocket API on the same port. SQLite (invoices + all
# operational settings) lives on a mounted volume at /app/data.

# --- builder: full install, then build the server (tsc) + admin SPA (vite) ---
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV CI=1
# Toolchain to compile better-sqlite3's native addon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
# Manifests first so dependency layers cache across source-only changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY admin-ui/package.json admin-ui/
RUN pnpm install --frozen-lockfile
# Sources, then build both packages (-> dist/ and admin-ui/dist/).
COPY tsconfig.json ./
COPY src ./src
COPY admin-ui ./admin-ui
RUN pnpm build

# --- proddeps: production-only node_modules (with the compiled .node addon) ---
FROM node:22-bookworm-slim AS proddeps
WORKDIR /app
ENV CI=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY admin-ui/package.json admin-ui/
RUN pnpm install --frozen-lockfile --prod

# --- runtime: minimal image that just runs the server ----------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATABASE_PATH=/app/data/sentinelle.sqlite
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/admin-ui/dist ./admin-ui/dist
COPY package.json ./
# Persist the SQLite database outside the container, owned by the node user.
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME ["/app/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]

# syntax=docker/dockerfile:1
# Production image: the bundled server (apps/server/dist) serving the built web app.
# The server bundle includes its dependencies, so the final stage has no node_modules.

ARG NODE_VERSION=26

FROM node:${NODE_VERSION}-slim AS base
# Node 25+ no longer ships corepack. Install it so the pnpm version pinned in package.json is used.
RUN npm install --global corepack@0.36.0 && corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo

# Keep only the workspace packages the server and web app need, so unrelated changes
# don't invalidate the install layer.
FROM base AS pruned
COPY . .
# Same Turborepo version as the repo's package.json, so the two can't drift apart.
RUN npx --yes "turbo@$(node -p "require('./package.json').devDependencies.turbo")" \
      prune @povik/server @povik/web --docker

FROM base AS build
COPY --from=pruned /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruned /repo/out/full/ .
RUN pnpm turbo run build --filter=@povik/server --filter=@povik/web

FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production \
    POVIK_HOST=0.0.0.0 \
    POVIK_PORT=8080 \
    POVIK_WEB_DIR=/app/public
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/server/dist ./dist
COPY --from=build --chown=node:node /repo/apps/web/dist ./public
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.POVIK_PORT}/healthz`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/index.mjs", "serve"]

# syntax=docker/dockerfile:1
# Mise app image (tech §3): one container serves the built SPA, the REST API and SSE.
# Build: docker build -t mise-app:<git-sha> .      Runtime config: infra/compose.yaml + env file.
#
# Workspace packages (@mise/contracts, @mise/domain) are compiled with tsc (A19 decision (a), no
# bundler). Only this image points their `main` at dist/; dev and tests keep running from source.

# Pinned by tag; Dependabot (docker ecosystem) proposes updates. Record the digest at go-live.
ARG NODE_IMAGE=node:24.22.3-alpine

FROM ${NODE_IMAGE} AS base
RUN corepack enable
WORKDIR /app
# Every workspace manifest, so `--frozen-lockfile` sees the same workspace as the lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY database/package.json database/

# ---- build: compile workspace packages, server and web ----
FROM base AS build
# Full install: the web build also needs root dev tooling (vite.config imports vitest/config).
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/domain packages/domain
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm --filter @mise/contracts build \
 && pnpm --filter @mise/domain build \
 && pnpm --filter @mise/server build \
 && pnpm --filter @mise/web build
# Fail the build if any test code or test support made it into the emitted output (A09 follow-up).
RUN leaked="$(find apps/server/dist packages/contracts/dist packages/domain/dist -type f \
      \( -name '*test*' -o -name '*harness*' -o -path '*support*' -o -name '*.ts' \))"; \
    if [ -n "$leaked" ]; then echo "test or source files in dist:"; echo "$leaked"; exit 1; fi; \
    find apps/server/dist packages/contracts/dist packages/domain/dist -type f | sort

# ---- prod-deps: production dependencies only, then the compiled output on top ----
FROM base AS assemble
RUN pnpm install --frozen-lockfile --prod --filter @mise/server...
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/apps/web/dist web
# Point the workspace packages at their compiled output; drop manifests nothing at runtime needs.
RUN for p in packages/contracts packages/domain; do \
      node -e 'const fs=require("fs");const f=process.argv[1];const j=JSON.parse(fs.readFileSync(f));j.main="dist/index.js";delete j.scripts;delete j.devDependencies;fs.writeFileSync(f,JSON.stringify(j,null,2));' "$p/package.json"; \
    done \
 && rm -rf apps/web database

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST_DIR=/app/web
WORKDIR /app
COPY --from=assemble --chown=root:root /app /app
# Non-root, and the app tree is not writable by the runtime user (compose also sets read_only).
USER node
WORKDIR /app/apps/server
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Admin CLIs run in the same image: docker compose exec mise node dist/cli/<command>.js ...
CMD ["node", "dist/main.js"]

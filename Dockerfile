# ═══════════════════════════════════════════════════════════════════════════════
# Lodestar — Multi-stage Docker build
# Stage 1: Install deps + compile TypeScript
# Stage 2: Lean runtime image with only production artifacts
# ═══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: Build ────────────────────────────────────────────────────────────

FROM node:20-alpine AS build

WORKDIR /app

# Copy workspace root manifests & lockfile first (layer cache for deps)
COPY package.json package-lock.json* tsconfig.json tsconfig.base.json ./

# Copy every package's manifest so npm ci resolves workspace links
COPY packages/core/package.json          packages/core/package.json
COPY packages/swara/package.json         packages/swara/package.json
COPY packages/anina/package.json         packages/anina/package.json
COPY packages/smriti/package.json        packages/smriti/package.json
COPY packages/ui/package.json            packages/ui/package.json
COPY packages/yantra/package.json        packages/yantra/package.json
COPY packages/dharma/package.json        packages/dharma/package.json
COPY packages/netra/package.json         packages/netra/package.json
COPY packages/vayu/package.json          packages/vayu/package.json
COPY packages/sutra/package.json         packages/sutra/package.json
COPY packages/tantra/package.json        packages/tantra/package.json
COPY packages/vidhya-skills/package.json packages/vidhya-skills/package.json
COPY packages/niyanta/package.json       packages/niyanta/package.json
COPY packages/cli/package.json           packages/cli/package.json

RUN npm ci

# Copy all source (tsconfigs + src dirs only — .dockerignore strips the rest)
COPY packages/ packages/

# Build the entire monorepo in dependency order
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────

FROM node:20-alpine AS runtime

WORKDIR /app

# Install curl for the HEALTHCHECK probe
RUN apk add --no-cache curl

# Copy root manifest (needed for workspace resolution at runtime)
COPY package.json package-lock.json* ./

# Copy every package's manifest
COPY packages/core/package.json          packages/core/package.json
COPY packages/swara/package.json         packages/swara/package.json
COPY packages/anina/package.json         packages/anina/package.json
COPY packages/smriti/package.json        packages/smriti/package.json
COPY packages/ui/package.json            packages/ui/package.json
COPY packages/yantra/package.json        packages/yantra/package.json
COPY packages/dharma/package.json        packages/dharma/package.json
COPY packages/netra/package.json         packages/netra/package.json
COPY packages/vayu/package.json          packages/vayu/package.json
COPY packages/sutra/package.json         packages/sutra/package.json
COPY packages/tantra/package.json        packages/tantra/package.json
COPY packages/vidhya-skills/package.json packages/vidhya-skills/package.json
COPY packages/niyanta/package.json       packages/niyanta/package.json
COPY packages/cli/package.json           packages/cli/package.json

# Install production dependencies only
RUN npm ci --omit=dev

# Copy compiled output from build stage
COPY --from=build /app/packages/core/dist          packages/core/dist
COPY --from=build /app/packages/swara/dist         packages/swara/dist
COPY --from=build /app/packages/anina/dist         packages/anina/dist
COPY --from=build /app/packages/smriti/dist        packages/smriti/dist
COPY --from=build /app/packages/ui/dist            packages/ui/dist
COPY --from=build /app/packages/yantra/dist        packages/yantra/dist
COPY --from=build /app/packages/dharma/dist        packages/dharma/dist
COPY --from=build /app/packages/netra/dist         packages/netra/dist
COPY --from=build /app/packages/vayu/dist          packages/vayu/dist
COPY --from=build /app/packages/sutra/dist         packages/sutra/dist
COPY --from=build /app/packages/tantra/dist        packages/tantra/dist
COPY --from=build /app/packages/vidhya-skills/dist packages/vidhya-skills/dist
COPY --from=build /app/packages/niyanta/dist       packages/niyanta/dist
COPY --from=build /app/packages/cli/dist           packages/cli/dist

# Non-root user for security
RUN addgroup -S chitragupta && adduser -S chitragupta -G chitragupta
USER chitragupta

EXPOSE 3141

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD curl -sf http://127.0.0.1:3141/api/health || exit 1

CMD ["node", "packages/cli/dist/cli.js", "serve"]

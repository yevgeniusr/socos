# Combined SOCOS: Next.js web + NestJS API in one container
# API runs on :3001, Next.js on :3000
# v6 - force rebuild: CommonJS NestJS fix
FROM node:22-alpine AS deps

WORKDIR /app

RUN apk add --no-cache python3 make g++

RUN corepack enable && corepack prepare pnpm@10.10.0 --activate

COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/platform/package.json apps/platform/
COPY apps/web/package.json apps/web/
COPY services/api/package.json services/api/
COPY packages/agent-core/package.json packages/agent-core/
COPY packages/shared/package.json packages/shared/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/typescript-config/package.json packages/typescript-config/

RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.10.0 --activate

COPY --from=deps /app/ ./

COPY apps/web/ apps/web/
COPY services/api/ services/api/
COPY packages/ packages/

# Generate Prisma client (pnpm ignores prisma build scripts, so do it explicitly)
WORKDIR /app/services/api
RUN pnpm exec prisma generate

WORKDIR /app

# Build Next.js standalone
WORKDIR /app/apps/web
RUN pnpm build

# Build NestJS with CommonJS output (fixes ESM module resolution in container)
WORKDIR /app/services/api
RUN sed -i 's/"module": "nodenext"/"module": "commonjs"/' tsconfig.json && \
    sed -i 's/"moduleResolution": "nodenext"/"moduleResolution": "node"/' tsconfig.json && \
    pnpm build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache tini ca-certificates && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    update-ca-certificates

# Copy Next.js standalone build
COPY --from=builder /app/apps/web/.next/standalone ./

# Copy Next.js static assets
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

# Copy NestJS API (dist + all node_modules including @nestjs packages)
COPY --from=builder /app/services/api/dist ./services/api/dist
COPY --from=builder /app/services/api/node_modules ./services/api/node_modules
COPY --from=builder /app/services/api/package.json ./services/api/package.json
COPY --from=builder /app/services/api/prisma ./services/api/prisma
COPY --from=builder /app/services/api/start.sh ./services/api/start.sh

# Remove "type":"module" so CommonJS dist runs as CommonJS (not ESM)
RUN sed -i '/"type": "module",/d' /app/services/api/package.json

# Also copy workspace node_modules for shared packages (Prisma, pg, etc.)
COPY --from=builder /app/node_modules ./node_modules

RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV API_INTERNAL_URL=http://localhost:3001
ENV NODE_PATH=/app/services/api/node_modules

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=30s \
  CMD wget -qO- http://localhost:3000/api/health-check > /dev/null && wget -qO- http://localhost:3001/api/health-check > /dev/null

# Start the API only after its migration gate passes, then start Next.js.
CMD ["tini", "--", "sh", "-c", "\
cd /app/services/api && \
sh start.sh & API_PID=$!; \
echo 'Waiting for NestJS to start...' && \
API_READY=0; \
for i in $(seq 1 30); do \
  if wget -qO- http://localhost:3001/api/health-check > /dev/null 2>&1; then \
    API_READY=1; echo 'NestJS ready, starting Next.js'; break; fi; \
  if ! kill -0 $API_PID 2>/dev/null; then echo 'NestJS exited before readiness' >&2; exit 1; fi; \
  echo 'Waiting... attempt '$i; sleep 2; \
done && \
[ $API_READY -eq 1 ] || { echo 'NestJS readiness timed out' >&2; exit 1; }; \
node /app/apps/web/server.js"]

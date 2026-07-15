# ---- Stage 1: Dependencies ----
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

# ---- Stage 2: Builder ----
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.10.0 --activate

COPY --from=deps /app/ ./

COPY services/api/ services/api/
COPY packages/ packages/

WORKDIR /app/services/api

RUN pnpm prisma generate
RUN pnpm build

RUN pnpm --filter @socos/api deploy --prod --legacy /prod/api

# Copy generated Prisma client into the deployed node_modules
RUN cp -r /app/node_modules/.pnpm/@prisma+client*/node_modules/@prisma/client /prod/api/node_modules/@prisma/client
RUN cp -r /app/node_modules/.pnpm/@prisma+client*/node_modules/.prisma /prod/api/node_modules/.prisma
RUN /prod/api/node_modules/.bin/prisma --version >/dev/null

# ---- Stage 3: Production runner ----
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nestjs && \
    adduser --system --uid 1001 --ingroup nestjs nestjs

COPY --from=builder /prod/api/node_modules ./node_modules
COPY --from=builder /app/services/api/dist ./dist
COPY --from=builder /app/services/api/prisma ./prisma
COPY --from=builder /app/services/api/package.json ./
COPY --from=builder /app/services/api/start.sh ./start.sh

USER nestjs

EXPOSE 3001

ENV PORT=3001

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=10s \
  CMD node -e "const http = require('http'); http.get('http://localhost:3001/api/health-check', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["sh", "start.sh"]

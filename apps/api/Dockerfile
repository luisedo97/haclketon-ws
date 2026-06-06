FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/desktop/package.json ./apps/desktop/
COPY apps/desktop/renderer/package.json ./apps/desktop/renderer/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/desktop/renderer ./apps/desktop/renderer
RUN pnpm --filter @ws-spy/shared build
RUN pnpm --filter @ws-spy/api db:generate
RUN pnpm --filter @ws-spy/api build
RUN pnpm --filter ws-spy-renderer build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/desktop/renderer/dist/ws-spy-renderer/browser ./apps/api/web
COPY package.json pnpm-workspace.yaml ./

RUN mkdir -p /data/sessions

WORKDIR /app/apps/api
ENV WEB_ROOT=/app/apps/api/web
EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/main.js"]

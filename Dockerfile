# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
# Keep the optional BLE package types for TypeScript without building native addons for the API.
RUN npm ci --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts

FROM base AS api
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build --chown=node:node /app/package.json /app/next.config.ts ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node src/server ./src/server
COPY --chown=node:node src/lib/dashboard-feed.ts src/lib/telemetry-history.ts ./src/lib/
USER node
EXPOSE 3000
CMD ["node", "src/server/web.ts"]

FROM base AS worker
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=tmpfs,target=/root/.npm npm ci --omit=dev --omit=optional
COPY --chown=node:node src/server ./src/server
COPY --chown=node:node src/lib/telemetry-history.ts ./src/lib/telemetry-history.ts
COPY --chown=node:node migrations ./migrations
USER node
CMD ["node", "src/server/worker.ts"]

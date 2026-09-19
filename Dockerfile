FROM node:22-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM deps AS server-build
COPY apps/server/tsconfig.json apps/server/tsconfig.json
COPY apps/server/src apps/server/src
RUN npm run build --workspace @ai-ops/server

FROM deps AS web-build
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/vite.config.ts apps/web/vite.config.ts
COPY apps/web/index.html apps/web/index.html
COPY apps/web/public apps/web/public
COPY apps/web/src apps/web/src
RUN npm run build --workspace @ai-ops/web

FROM deps AS server-runtime-deps
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS server

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4175 \
    PLATFORM_DB_PATH=/app/data/platform.sqlite

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY --from=server-runtime-deps /app/node_modules ./node_modules
COPY --from=server-build /app/apps/server/dist apps/server/dist
RUN mkdir -p /app/data

EXPOSE 4175
CMD ["node", "apps/server/dist/index.js"]

FROM node:22-bookworm-slim AS web

WORKDIR /app
ENV NODE_ENV=production \
    VITE_BFF_URL=http://server:4175

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/web/vite.config.ts apps/web/vite.config.ts
COPY --from=deps /app/node_modules ./node_modules
COPY --from=web-build /app/apps/web/dist apps/web/dist

WORKDIR /app/apps/web
EXPOSE 4174
CMD ["../../node_modules/.bin/vite", "preview", "--host", "0.0.0.0", "--port", "4174"]

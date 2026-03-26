FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json

RUN npm ci --workspace backend

FROM deps AS build
WORKDIR /app

COPY backend backend

RUN npm run --workspace backend build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json

RUN npm ci --omit=dev --workspace backend && npm cache clean --force

COPY --from=build /app/backend/dist ./backend/dist

WORKDIR /app/backend

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/server.js"]

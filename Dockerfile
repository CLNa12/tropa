# Образ Tropa. Сборка в три этапа, чтобы в готовый образ не попали ни исходники
# интерфейса, ни инструменты сборки — только то, что нужно для работы.

# 1. Интерфейс: ставим его зависимости и собираем статику в web/dist.
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 2. Зависимости сервера — без dev-пакетов.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 3. Готовый образ.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4317 \
    TROPA_HOME=/data

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server/ ./server/
COPY mcp/ ./mcp/
COPY --from=web /app/web/dist ./web/dist

# Карты лежат в томе и переживают пересборку образа. Папка отдаётся пользователю node:
# внутри контейнера приложение работает не от root.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 4317

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4317)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]

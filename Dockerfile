# Один образ для API, админки и модуля бронирования; что запускать, задаёт docker-compose.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY apps/admin/package.json apps/admin/package-lock.json apps/admin/
COPY apps/booking/package.json apps/booking/package-lock.json apps/booking/
RUN cd apps/admin && npm ci && cd ../booking && npm ci
COPY . .
# Админка и модуль бронирования ходят в API внутри docker-сети; адрес вшивается при сборке
ENV API_URL=http://api:3000 NEXT_TELEMETRY_DISABLED=1
RUN npm run build && cd apps/admin && npx next build && cd ../booking && npx next build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
EXPOSE 3000 3100 3200
CMD ["node", "dist/apps/api/src/main.js"]

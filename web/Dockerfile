# Web de Sin Humo: se compila con Node y se sirve con nginx (que además reenvía la API).
FROM node:22-bookworm-slim AS build
WORKDIR /web
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

# Pruebas: `docker compose run --rm web-test`
FROM build AS test
CMD ["npm", "test"]

FROM nginx:1.29-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

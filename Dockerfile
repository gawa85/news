# Sin Humo: imagen de desarrollo/pruebas (target "dev") y de producción (target "runtime").
#   docker build --target runtime -t sin-humo .
ARG NODE_VERSION=22

# --- Dependencias completas (incluye TypeScript y tipos) ---
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Desarrollo y pruebas: código fuente + dependencias completas ---
FROM deps AS dev
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
RUN npm run build
CMD ["npm", "test"]

# --- Dependencias de producción solamente ---
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- Producción: sólo lo compilado de src, usuario sin privilegios ---
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    APP_ENV=production \
    PORT=8080
# OCR local (capturas de pantalla sin servicios externos): Tesseract con castellano, inglés y portugués.
RUN apt-get update   && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng tesseract-ocr-por   && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=dev /app/dist/src ./dist/src
COPY package.json ./
# Texto de términos y privacidad: se carga la primera vez (después se publican versiones desde el backoffice).
COPY docs/legal ./docs/legal
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "dist/src/entry/server.js"]

# Sin Humo

Separa hechos de humo en noticias, mails y mensajes. Compara fuentes y mide la credibilidad de los medios por tema, período y región. Funciona por WhatsApp, Telegram, mail, web, API, bots y agentes de IA (MCP).

- **[ARCHITECTURE.md](ARCHITECTURE.md)**: arquitectura hexagonal con SOLID, módulos, reglas de negocio y cómo extender.
- **[DATABASE.md](DATABASE.md)**: qué base de datos conviene y por qué.

## Requisitos

Docker (recomendado), o Node.js 22 o superior. PostgreSQL 14+ para producción (opcional para probar).

## Con Docker

No hace falta tener Node instalado. El `Dockerfile` tiene dos imágenes: `dev` (compilación y pruebas) y `runtime` (producción: sólo lo compilado, usuario sin privilegios, chequeo de `/health`).

```bash
docker compose up -d --build                         # web en http://localhost:8090, API en :8091, PostgreSQL (con datos de demo)
docker compose run --rm web-test                     # pruebas de la web (ver web/README.md)
docker compose logs -f api

docker compose run --rm test                         # pruebas en memoria
docker compose run --rm -e TEST_STORE=sqlite test    # ...en SQLite
docker compose run --rm test npm run test:postgres   # ...en PostgreSQL (vacía antes la base sinhumo_test)
docker compose run --rm test npm run demo:platform

docker compose exec api node dist/src/entry/backup-cli.js listar
docker compose down                                  # agregar -v para borrar también la base
```

- Los puertos del host se cambian con `API_PORT` y `PG_PORT` (por ejemplo, en `.env`).
- El servicio `test` monta `src/` y `tests/`, así que los cambios se prueban sin reconstruir la imagen. Si cambia `package.json`, hay que reconstruirla con `docker compose build test`.
- Las claves de `docker-compose.yml` son **sólo para desarrollo**. En producción se usa la imagen `runtime` con los secretos reales (ver OPERATIONS.md).

## Probar con servicios reales

Todas las claves van en `.env` (junto a `docker-compose.yml`; no se sube al repo). Plantilla completa: `.env.example`. Una variable vacía = función apagada. Después de cambiar `.env`: `docker compose up -d api`.

**Sin cuenta:**

```bash
EVIDENCE_TSA_URL=https://freetsa.org/tsr     # sello de tiempo RFC 3161 (para uso legal: un certificador licenciado)
EVIDENCE_WAYBACK=1                           # copia en la Wayback Machine (sin cuenta responde 429 seguido: se reintenta
                                             # sola; con una cuenta gratis de archive.org, EVIDENCE_WAYBACK_AUTH=clave:secreto)
CAPTCHA_SITE_KEY=1x00000000000000000000AA    # claves de PRUEBA de Cloudflare Turnstile: siempre aprueba
CAPTCHA_SECRET=1x0000000000000000000000000000000AA   # (2x0000000000000000000000000000000AA: siempre rechaza)
```

**Notas de voz y capturas, locales** (sin servicios externos ni costo por uso):

```bash
docker compose --profile ia-local up -d whisper   # whisper.cpp; la primera vez baja el modelo (~470 MB)
# en .env:
SPEECH_TO_TEXT_PROVIDER=local                      # notas de voz → el servicio whisper
OCR_PROVIDER=tesseract                             # capturas → Tesseract (viene en la imagen de la API)
```

Probado con una nota de voz real en castellano (8 s de audio → 8 s de CPU, 4 hilos) y una captura de WhatsApp (0,3 s).

**Telegram** (el bot sale gratis con @BotFather → `/newbot`):

1. En `.env`: `TELEGRAM_BOT_TOKEN=<token>` y `TELEGRAM_SECRET_TOKEN=<al menos 16 letras/números al azar>`. `docker compose up -d api`.
2. Mandale "hola" a tu bot y mirá tu chat id: `docker compose exec api node dist/src/entry/telegram-setup.js`
3. Fuera de producción sólo se le manda a quien esté en la lista: `SANDBOX_RECIPIENTS=<tu chat id>` (y los mails o números del equipo, separados por coma). `docker compose up -d api`.
4. Telegram necesita una URL pública https. Túnel gratis de Cloudflare (sin cuenta): `docker compose --profile tunel up -d tunel` y la URL `https://….trycloudflare.com` sale en `docker compose logs tunel`.
5. Registrar el webhook: `docker compose exec api node dist/src/entry/telegram-setup.js https://….trycloudflare.com`

La URL del túnel cambia cada vez que se reinicia: hay que repetir el paso 5. Todo lo que sale en desarrollo lleva el prefijo `[PRUEBA]`.

## Probarlo sin Docker

```bash
npm install
npm run demo            # núcleo: humo, comparación, origen, credibilidad
npm run demo:platform   # plataforma: WhatsApp, planes, roles, foro, impacto, reseñas, MCP, cumplimiento
npm test                # tests en memoria y SQLite

# La misma batería sobre SQLite o PostgreSQL:
npm run test:sqlite
TEST_DATABASE_URL=postgres://usuario:clave@localhost:5432/base npm run test:postgres
```

## Correrlo

```bash
cp .env.example .env    # completar lo que se use (cada integración se activa si están sus credenciales)
npm run build
npm start               # API HTTP + webhooks + recepción SMTP + tareas periódicas
npm run mcp             # servidor MCP por stdio para un agente de IA
```

> Todos los medios, dueños, lugares, partidos y cifras de las demos son ficticios. Los precios de los planes son de ejemplo.

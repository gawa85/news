# Sin Humo

Separa hechos de humo en noticias, mails y mensajes. Compara fuentes y mide la credibilidad de los medios por tema, período y región. Funciona por WhatsApp, Telegram, mail, web, API, bots y agentes de IA (MCP).

- **[ARCHITECTURE.md](ARCHITECTURE.md)**: arquitectura hexagonal con SOLID, módulos, reglas de negocio y cómo extender.
- **[DATABASE.md](DATABASE.md)**: qué base de datos conviene y por qué.

## Requisitos

Docker (recomendado), o Node.js 22 o superior. PostgreSQL 14+ para producción (opcional para probar).

## Con Docker

No hace falta tener Node instalado. El `Dockerfile` tiene dos imágenes: `dev` (compilación y pruebas) y `runtime` (producción: sólo lo compilado, usuario sin privilegios, chequeo de `/health`).

```bash
docker compose up -d --build                         # API en http://localhost:8090 + PostgreSQL (con datos de demo)
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

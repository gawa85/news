# Operación: ambientes, copias y recuperación

## Ambientes

| | development | test | staging | production |
|---|---|---|---|---|
| Base | memoria o SQLite | memoria/SQLite/PostgreSQL | PostgreSQL | PostgreSQL |
| Datos | demo | falsos | **copia anonimizada** de producción | reales |
| Mensajes | sólo a `SANDBOX_RECIPIENTS`, con "[DESARROLLO]" | grabados | sólo a `SANDBOX_RECIPIENTS`, con "[PRUEBA]" | a quien corresponda |
| Pagos | prueba | falsos | prueba (sandbox del proveedor) | reales |
| https / secretos fuertes / copias | no | no | https, secretos fuertes | **obligatorio todo** |

Se elige con `APP_ENV`. Al arrancar se valida la configuración y, si falta algo crítico, el servidor **no arranca** y dice qué falta.

## Copias de seguridad

**Objetivos:** RPO (cuántos datos se pueden perder) ≤ 24 h con la copia lógica, **≤ 5 min con WAL en PostgreSQL**. RTO (cuánto tarda volver) ≤ 2 h.

1. **Copia lógica diaria** (trabajo `backup_daily`): cifrada, con suma de verificación, en `BACKUP_DIR` o S3/R2 (idealmente **en otra cuenta u otro proveedor** que la base).
2. **Verificación semanal** (trabajo `backup_verify`): se restaura la última en una base vacía y se comparan cantidades. Si falla, el trabajo queda en error y dispara la alerta.
3. **PostgreSQL en producción, además:** copias físicas con archivo continuo de WAL (el servicio administrado de la base, o `pgBackRest`/`wal-g`) para recuperar a un minuto dado.
4. **La frase `BACKUP_PASSPHRASE`** se guarda en un gestor de secretos **y** fuera de línea (sobre cerrado o bóveda). Sin ella, las copias no se pueden leer.
5. **`VAULT_MASTER_KEY`** también: las contraseñas de buzones conectados están cifradas con esa clave dentro de la copia.

### Restaurar (procedimiento)

1. Crear una base **vacía** nueva (nunca sobre la que falló).
2. `npm run backup -- listar` y elegir la copia (verificada, idealmente).
3. `APP_ENV=production npm run backup -- restaurar <clave> --destino <url-de-la-base-nueva> --confirmo`
4. Levantar el servidor apuntando a la base nueva, con la **misma** `VAULT_MASTER_KEY`.
5. Chequear: `/health`, entrar a la web, analizar un mensaje de prueba y revisar la cola de trabajos.
6. Todas las sesiones se cierran (las sesiones no se respaldan): avisar que hay que volver a entrar.
7. Registrar el incidente (qué pasó, qué se perdió, tiempos) y revisar el procedimiento.

### Refrescar staging con datos de producción (anonimizados)

```
APP_ENV=production STAGING_SCRUB_SECRET=… npm run backup -- copia-staging
# en staging, con una base vacía:
APP_ENV=staging npm run backup -- restaurar staging/…/sinhumo-…-staging_copy.shbk --destino $DATABASE_URL --confirmo
```
La copia no tiene secretos, claves de API, webhooks ni conexiones, y los teléfonos, mails, nombres y textos están reemplazados.

## Antes de cada migración de esquema

`npm run backup -- crear pre_migration` (se conserva un año), después `migrate()`.

## Simulacro trimestral

Restaurar la última copia en una base nueva siguiendo el procedimiento, medir el tiempo y anotar los problemas.

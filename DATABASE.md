# ¿Qué base de datos conviene?

## Recomendación corta

**PostgreSQL como base principal**, desde el día uno. Recién cuando haga falta, se suman piezas especializadas alrededor: Redis para contadores y colas, almacenamiento de objetos para mails y HTML crudos, y un motor analítico si los reportes crecen mucho. Gracias a `IDataStore`, esas decisiones se pueden tomar después sin reescribir el sistema.

## Por qué PostgreSQL

Los datos de Sin Humo son de dos tipos, y PostgreSQL resuelve bien los dos en un solo motor:

| Tipo de dato | Qué necesita | Cómo lo cubre PostgreSQL |
|---|---|---|
| **Negocio**: usuarios, roles, suscripciones, pagos, uso, claves de API | Transacciones ACID, unicidad garantizada, integridad | Transacciones reales, claves únicas, claves foráneas |
| **Contenido**: notas, afirmaciones, análisis, mails, reseñas | Estructura flexible que cambia seguido | **JSONB** con índices (GIN); es justo el diseño "documento + columnas indexadas" de este código |
| Búsqueda de texto | Buscar notas y afirmaciones en español | Búsqueda de texto completo con diccionario `spanish` |
| Similitud semántica | Agrupar afirmaciones y rastrear "quién lo dijo primero" con embeddings | Extensión **pgvector** |
| Series de tiempo | Uso, envíos, impacto, credibilidad por período | Particionado por fecha e índices BRIN |
| Redes de propiedad | Quién es dueño de qué medio, y de qué más | Consultas recursivas (`WITH RECURSIVE`) |
| Operación | Backups, réplicas, alta disponibilidad | Servicios administrados en todas las nubes, incluso con regiones en Sudamérica |

## Por qué no otras como principal

- **MongoDB u otra documental.** La flexibilidad que aporta ya la da JSONB, y lo más delicado del negocio (cobros, permisos, cuotas, "una dirección = un usuario") pide transacciones y restricciones relacionales. Usar las dos al principio sería duplicar la operación sin necesidad.
- **SQLite.** Excelente para desarrollo, tests, una instalación chica o un modo local, y el sistema ya lo soporta. Pero admite un solo escritor a la vez y no sirve para varias instancias del servidor atendiendo en paralelo.
- **Solo Redis o una base clave-valor.** Es rápida para contadores, pero no sirve como fuente de verdad del negocio ni para consultas por tema y período.
- **Una base de grafos (Neo4j).** Solo tendría sentido si el análisis de redes de propiedad e influencia se vuelve central. Mientras tanto, PostgreSQL alcanza.

## Qué va en cada lugar (a medida que crece)

| Etapa | Dónde se guarda | Qué |
|---|---|---|
| **1. Lanzamiento** | PostgreSQL | Todo: las 81 tablas actuales |
| **2. Varias instancias del servidor** | + **Redis / Valkey** | Límites de frecuencia y cuotas en caliente, códigos de verificación (con vencimiento automático), cola de trabajos (sincronizar fuentes, medir impacto, enviar webhooks) |
| **3. Volumen de contenido** | + **Almacenamiento de objetos** (compatible con S3) | Mails crudos (.eml), HTML de las notas y adjuntos. En PostgreSQL queda solo la referencia |
| **4. Millones de eventos** | PostgreSQL particionado → luego un **motor columnar** (ClickHouse o un data warehouse) | `usage_events`, `delivery_log`, `impact_snapshots` y los tableros de impacto y credibilidad |
| **5. Búsqueda avanzada** | + **OpenSearch / Meilisearch** | Solo si la búsqueda de texto de PostgreSQL queda corta |

## Cómo está preparado el código

- `IDataStore` es la única puerta a la base. Los casos de uso ven repositorios (`IUserRepository`, `IArticleReader`…), nunca SQL.
- Los repositorios se escribieron **una vez** sobre `IDocumentCollection`. Memoria, SQLite y PostgreSQL implementan solo esa pieza, y **pasan la misma batería de tests**. Hoy corre la plataforma completa, con sus 93 tests, sobre los tres motores.
- Las **transacciones** (`transaction(repos => …)`) garantizan que, por ejemplo, alta de usuario + canal + suscripción se guarden todas o ninguna.
- La **unicidad crítica** la garantiza la base, no el código. Que una dirección de WhatsApp o un mail pertenezca a un solo usuario es una clave primaria en `channel_links`.
- `migrate()` es idempotente y agrega columnas de índice nuevas cuando el esquema crece.

## Próximos pasos en PostgreSQL

1. **Migraciones versionadas** (archivos numerados y aplicados en orden) en lugar de "crear si no existe".
2. Pasar a **columnas tipadas con claves foráneas** los campos críticos del negocio: suscripciones, uso y claves de API (hash con índice único).
3. Índices **GIN** sobre JSONB y columna `tsvector` en español para notas y afirmaciones.
4. **pgvector** para agrupar afirmaciones por significado (reemplaza al Jaccard actual).
5. **Particionado mensual** de `usage_events`, `delivery_log` e `impact_snapshots`, con una política de retención.

## Datos personales

Se guardan teléfonos, mails y textos reenviados, así que aplica la Ley 25.326 de Protección de Datos Personales:
- El diseño ya cifra los secretos (AES-256-GCM).
- Guarda los destinatarios del registro de envíos como **hash**.
- Cuenta los clics sin identificar a nadie.

Falta definir plazos de retención y el procedimiento para que una persona pida ver o borrar sus datos.

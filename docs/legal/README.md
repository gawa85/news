# Documentos legales — BORRADORES

> ⚠️ **BORRADORES PARA REVISIÓN.** No son asesoramiento legal ni están listos para publicar.
> Tienen que revisarlos abogadas/os matriculadas/os en Argentina (y en cada país donde se venda)
> antes de usarse. Las normas citadas hay que confirmarlas y actualizarlas en esa revisión.

| Documento | Para qué |
|---|---|
| [TERMINOS.md](TERMINOS.md) | Contrato con quien usa el servicio (personas y organizaciones). |
| [PRIVACIDAD.md](PRIVACIDAD.md) | Qué datos se tratan, para qué, cuánto tiempo y cómo ejercer derechos. |
| [RIESGO_DIFAMACION.md](RIESGO_DIFAMACION.md) | Análisis del riesgo de publicar evaluaciones de medios y cómo lo mitiga el producto. |

## Cómo se conectan con el sistema

- Versiones vigentes en `src/config/legal.ts`. Cambiar la versión de un documento **material** hace que se pida aceptarlo de nuevo.
- Se guarda quién aceptó qué versión, cuándo y por qué medio (`legal_consents`). En el chat se muestra el aviso con los links y se registra como `chat_notice`.
- El detector de riesgo de difamación (`src/domain/rules/defamation.ts`) manda a revisión humana los textos públicos que atribuyen delitos, mentiras deliberadas o intenciones ocultas a un medio o a sus dueños.

## Pendientes para la revisión legal

1. Razón social, CUIT, domicilio y datos de contacto del responsable.
2. Inscripción de las bases de datos en el Registro Nacional de Bases de Datos (AAIP).
3. Cláusulas para transferencias internacionales con cada proveedor (hosting, WhatsApp/Meta, Telegram, IA, pagos, correo).
4. Validar la aceptación por aviso en el chat frente a la normativa de defensa del consumidor.
5. Validar el tratamiento de datos de estudiantes menores en el modo aprendizaje (autorizaciones que debe gestionar cada escuela).
6. Adaptaciones por país (Uruguay, Chile, México) antes de vender allí.

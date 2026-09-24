# Riesgo de difamación al evaluar medios

> ⚠️ **BORRADOR para revisión legal.** Resume riesgos y medidas del producto; no es un dictamen.
> Las normas y fallos citados hay que confirmarlos en la revisión.

## 1. El riesgo

Sin Humo publica (o permite publicar) evaluaciones sobre medios identificables: indicadores de credibilidad, comparaciones, campañas, respuestas públicas y "otras miradas". Un medio, su dueño o un periodista podrían considerar que una evaluación **afecta su honor o reputación** y reclamar:

- **Civilmente:** daños por afectación de la dignidad y el honor (Código Civil y Comercial, arts. 52, 1737 y ss.).
- **Penalmente:** calumnias o injurias (Código Penal, arts. 109 y 110). Tras la **Ley 26.551**, no configuran delito las expresiones sobre **asuntos de interés público** ni las que **no son asertivas**, lo que reduce el riesgo penal para evaluaciones sobre medios y temas públicos, pero no el civil.
- **Reputacional:** pérdida de confianza en el producto si una evaluación resulta errónea.

## 2. Protecciones que da el marco (a confirmar)

- Libertad de expresión e información (Constitución Nacional, arts. 14 y 32; Convención Americana, art. 13). La búsqueda y difusión de información por internet está comprendida en esa protección (Ley 26.032).
- **Doctrina "Campillay"** (CSJN): se reduce la responsabilidad al **citar la fuente**, usar un **tiempo verbal potencial** o **no identificar** al afectado.
- **Real malicia** (CSJN, entre otros "Patitó"): respecto de figuras públicas y temas de interés público, el reclamante debe probar que se sabía que la información era falsa o se actuó con notoria despreocupación por su verdad.
- Distinción entre **afirmaciones de hecho** (verificables) y **opiniones o juicios de valor** (que no son susceptibles de prueba de verdad).
- **Derecho de rectificación o respuesta** (Convención Americana, art. 14): ofrecerlo de forma efectiva es a la vez una obligación y una defensa.

## 3. Medidas del producto (ya implementadas)

| Medida | Dónde |
|---|---|
| Evaluaciones presentadas como **opinión fundada con metodología pública**, por tema, período y lugar, con tamaño de muestra y aviso de límites | Medidor de credibilidad (`disclaimer`) |
| Desglose por dimensión con evidencia (no un número único sin explicación) | `EvaluateCredibilityUseCase` |
| Se describe **lo verificado** ("la nota dice X; el dato oficial es Y") con **fuente primaria** citada | Verificación y fuentes primarias |
| **Derecho a réplica**: el medio acreditado responde; la réplica se muestra junto a la evaluación; si es aceptada, se corrige y se publica fe de erratas | `RebuttalService` |
| **Detector de riesgo de difamación**: textos públicos que atribuyen delitos, mentiras deliberadas, sobornos u "operaciones" a un medio o a sus dueños van a **revisión humana** con sugerencia de reescritura | `domain/rules/defamation.ts`, `DefamationAwareModerator` |
| Moderación y aprobación de campañas y respuestas públicas por **otra persona** | Campañas y respuestas |
| Cada campaña identifica siempre a su emisor | Campañas |
| Datos de propiedad y pauta con **fuente** de cada dato (datos públicos) | Catálogo |
| Versionado del algoritmo y métricas de calidad públicas; corrección de errores documentada | Calidad |
| Auditoría de quién publicó, aprobó o cambió qué | Auditoría |

## 4. Reglas de redacción (para el equipo y para los textos automáticos)

1. **Describir, no calificar intenciones.** ✅ "La nota afirma que el aumento es de 50%; la Resolución 45 fija 30%." ❌ "El medio miente."
2. **Citar siempre la fuente** y el período analizado.
3. **Potencial y matiz** cuando no hay certeza ("según…", "de acuerdo con…").
4. **Nunca** atribuir delitos, sobornos, "operaciones" o motivaciones ocultas a personas o medios identificables.
5. Separar **hechos** de **opiniones**, y marcar las opiniones como tales.
6. Ofrecer y mostrar el **derecho a réplica**.
7. Ante un reclamo: revisar en 48 h, corregir si corresponde, publicar la fe de erratas y dejar registro.

## 5. Recomendaciones pendientes

- Póliza de seguro de responsabilidad civil profesional / de medios.
- Protocolo de respuesta ante cartas documento (plazos, responsables, preservación de evidencia).
- Revisión legal de la metodología pública del medidor de credibilidad.
- Consejo asesor externo (periodismo y derecho) para casos dudosos.
- Revisión por país antes de publicar evaluaciones de medios de Uruguay, Chile o México.

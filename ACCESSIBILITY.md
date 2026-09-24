# Accesibilidad e inclusión

Objetivo: que cualquier persona pueda entender qué es humo y qué es dato, lea bien o no, vea bien o no.
Referencia para la web: **WCAG 2.2 nivel AA**. La web y el backoffice se diseñan aparte; este documento fija lo que el backend ya garantiza y lo que la web tiene que cumplir.

## Lo que ya hace el sistema

| Necesidad | Cómo se resuelve |
|---|---|
| Poca alfabetización | `/formato fácil`: lectura fácil (frases cortas, sin jerga, máximo 5 ideas). Con IA opcional (`LLMPlainLanguageRewriter`). |
| Dificultad para leer / visual | `/audio si`: respuesta en audio (MP3) además del texto, por WhatsApp, Telegram o mail. |
| Lectores de pantalla | Mails con `lang="es"`, logo con `alt`, texto plano alternativo siempre. Tarjetas SVG con `role="img"`, `<title>` y `<desc>`. |
| Color | La marca blanca rechaza colores sin contraste 4,5:1 con texto blanco. La información nunca depende sólo del color: cada señal lleva texto ("Alarmismo: …"). |
| Atención / tiempo | Formato corto (`/formato corto`), horario de silencio (`/silencio 22-8`) y avisos postergados en vez de perdidos. |
| Aprender a detectarlo | Modo aprendizaje (`/jugar`) con explicación en lenguaje simple de cada tipo de humo. |
| Canales accesibles | Todo funciona por chat de texto (WhatsApp, Telegram, SMS y mail): no hace falta instalar nada ni usar una web. |

## Lo que tiene que cumplir la web (checklist WCAG 2.2 AA)

- [ ] Todo se usa con teclado; foco visible (2.4.7, 2.4.11); sin trampas de foco.
- [ ] Contraste de texto 4,5:1 (3:1 texto grande y componentes) (1.4.3, 1.4.11).
- [ ] Zoom al 200% y reflujo a 320 px sin scroll horizontal (1.4.4, 1.4.10).
- [ ] Encabezados y regiones (landmarks) correctos; `lang="es"` en la página (1.3.1, 3.1.1).
- [ ] Formularios con etiquetas visibles, errores en texto y cómo corregirlos (3.3.1–3.3.3); sin pedir datos ya cargados (3.3.7).
- [ ] Áreas táctiles de 24×24 px como mínimo (2.5.8).
- [ ] Gráficos del panel y del observatorio con tabla de datos equivalente y descripción.
- [ ] Salas en tiempo real: los mensajes nuevos se anuncian con `aria-live="polite"`, sin robar el foco.
- [ ] Sin límite de tiempo en el juego; animaciones que respetan `prefers-reduced-motion`.
- [ ] Autenticación sin pruebas cognitivas (enlace mágico o Google) (3.3.8).
- [ ] Prueba con lector de pantalla (NVDA y VoiceOver) y con personas usuarias antes de cada lanzamiento.

## Menores (modo aprendizaje en escuelas)

- En un aula sólo se guarda un apodo; se rechazan apodos con teléfonos, mails o links.
- El docente ve apodos y aciertos, nunca datos de contacto. No hay mensajes entre estudiantes.
- Ranking apagado por defecto.
- La escuela es responsable de contar con las autorizaciones que exija la normativa local para estudiantes menores (revisar con asesoría legal de cada país).

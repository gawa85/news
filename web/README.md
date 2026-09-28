# Web de Sin Humo (personas)

Aplicación React + TypeScript (Vite) para analizar, comparar fuentes, ver credibilidad, el historial y la cuenta.

## Correrla

```bash
docker compose up -d --build          # web en http://localhost:8090 (nginx + API por el mismo origen)
docker compose run --rm web-test      # pruebas (Vitest + Testing Library)
```

**Entrar en desarrollo:** pedí el enlace en `/entrar` y buscalo en el log de la API. Sin SMTP, los mails se escriben ahí:

```bash
docker compose logs api | grep "auth/magic"
```

Desarrollo con recarga en vivo (necesita Node 22): `npm install && SINHUMO_API=http://localhost:8091 npm run dev`.

## Cómo está hecha

- **Puerto y adaptador**, como el backend:
  - `api/SinHumoApi.ts` es la interfaz de lo que la web necesita del servidor.
  - `api/HttpSinHumoApi.ts` la implementa con `fetch`.
  - Las pantallas reciben la API por inyección (`ApiProvider`) y nunca llaman a `fetch`. En las pruebas se usa `test/FakeApi.ts`.
- **Mismo origen:** nginx sirve la web y reenvía `/v1`, `/auth`, `/public` y `/media` a la API. La sesión es una cookie `HttpOnly` que el código de la web nunca ve, y la API rechaza pedidos de otros orígenes (CSRF).
- **Por funcionalidad** (`features/`): acceso, analizar e historial, comparar, credibilidad, cuenta y planes.
- **Diseño:** `styles/tokens.css` define colores (claro y oscuro), tipografía y espacios, y `styles/base.css` los componentes. No se usan librerías de interfaz.
- **Seguridad:** hay una CSP que sólo permite scripts propios y los del captcha. Además, `X-Frame-Options: DENY` y `nosniff`, y después de entrar sólo se vuelve a rutas del propio sitio.

## Accesibilidad (WCAG 2.2 AA)

- Cada pantalla lleva el foco a su título al navegar, y hay un enlace para saltar al contenido.
- Los formularios tienen etiquetas visibles y los errores se asocian al campo (`aria-describedby`, `aria-invalid`). Los avisos usan `role="alert"`.
- El índice de humo y la credibilidad se muestran con número, barra y palabras: nunca sólo con color.
- Contraste de 4,5:1 o más, modo oscuro, áreas táctiles de 44 px y respeto de `prefers-reduced-motion`.
- El acceso es por enlace al mail o con Google: no hay pruebas cognitivas (3.3.8).
- Se verificó con axe-core en Chromium sobre todas las pantallas: 0 problemas. Falta probarla con lectores de pantalla (NVDA, VoiceOver) y con personas.

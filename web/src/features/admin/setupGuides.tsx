import type { ReactNode } from "react";
import { Link } from "react-router";

/** Una variable del archivo de configuración: nombre, ejemplo y qué es, en palabras. */
export interface EnvLine {
  name: string;
  example: string;
  meaning: string;
}

export interface Guide {
  /** Qué es, sin tecnicismos. */
  what: string;
  /** Para qué sirve / qué pasa si falta. */
  why?: string;
  /** Qué hace falta tener antes (cuentas, datos). */
  needs?: string[];
  steps: ReactNode[];
  env?: EnvLine[];
  /** Algo importante (seguridad, costos). */
  warning?: string;
}

/**
 * GUÍAS DE LA PUESTA EN MARCHA: para cada punto de la lista, qué es, por qué importa y cómo se hace,
 * paso a paso y con ejemplos. Escritas para quien no es técnico (y para pasárselas a quien maneja
 * el servidor).
 */
export const SETUP_GUIDES: Record<string, Guide> = {
  empresa: {
    what: "Los datos legales de quien ofrece Sin Humo: la empresa o la persona que factura y responde por el servicio.",
    why: "Aparecen en los términos, en la política de privacidad y en las facturas. La ley de defensa del consumidor y la de datos personales piden que estén.",
    needs: ["La razón social tal como figura en ARCA (ex AFIP).", "El CUIT.", "El domicilio legal.", "Un mail para consultas sobre datos personales."],
    steps: [
      <>Completá el formulario de arriba, «Datos de la empresa». El CUIT se puede escribir con o sin guiones: se controla el dígito verificador.</>,
      <>Si ya inscribiste la base de datos ante la AAIP (Registro Nacional de Bases de Datos), poné el número; si no, dejalo vacío por ahora.</>,
      <>Tocá «Guardar datos» y después «Completar términos y privacidad»: los datos se copian solos donde decía [RAZÓN SOCIAL], CUIT [●], etc.</>,
    ],
  },
  legal: {
    what: "Los términos y condiciones (qué ofrece Sin Humo y con qué límites) y la política de privacidad (qué datos se guardan y para qué).",
    why: "Sin términos y privacidad revisados no conviene abrir al público: son los que te cubren ante un reclamo.",
    needs: ["Los datos de la empresa cargados.", "Un/a abogado/a matriculado/a que los revise."],
    steps: [
      <>Cargá los datos de la empresa y tocá «Completar términos y privacidad» (arriba). Se publica una versión borrador con esos datos.</>,
      <>Lo que sigue entre corchetes lo decide la revisión legal. Por ejemplo, [365] (cuántos días se guardan los análisis) o [Mercado Pago / ●] (qué proveedores se usan).</>,
      <>Mandale el texto a tu abogado/a: lo ve en <Link to="/legal/terminos">/legal/terminos</Link> y <Link to="/legal/privacidad">/legal/privacidad</Link>.</>,
      <>Con el texto revisado, entrá a <Link to="/admin/legal">Documentos legales</Link>, pegalo, destildá «Es un borrador», tildá «Lo revisó un/a abogado/a» y publicá.</>,
    ],
    warning: "Si el cambio afecta derechos de las personas (precios, datos que se guardan), tildá «Cambio importante»: todas tienen que volver a aceptar.",
  },
  url: {
    what: "La dirección de internet donde vive Sin Humo (por ejemplo, https://sinhumo.com.ar), con el candado de conexión segura (HTTPS).",
    why: "Sin dominio propio con HTTPS los navegadores marcan el sitio como inseguro, los enlaces para entrar no funcionan afuera y WhatsApp y Telegram no pueden mandar mensajes al servidor.",
    needs: ["Un dominio (por ejemplo, en NIC Argentina para .com.ar).", "Un servidor con una dirección IP fija."],
    steps: [
      <>En el panel de tu dominio, creá un registro «A» que apunte a la IP del servidor. Ejemplo: sinhumo.com.ar → 203.0.113.10.</>,
      <>El certificado HTTPS lo saca solo un «proxy» delante de la web (Caddy). Quien maneja el servidor lo configura con dos renglones: <code>sinhumo.com.ar {"{"} reverse_proxy web:8080 {"}"}</code>.</>,
      <>Poné la dirección en el archivo de configuración (abajo) y reiniciá.</>,
    ],
    env: [{ name: "PUBLIC_BASE_URL", example: "https://sinhumo.com.ar", meaning: "La dirección pública, empezando con https://. Se usa en los enlaces de los mails y en los avisos." }],
  },
  ambiente: {
    what: "En qué modo corre Sin Humo: desarrollo (pruebas, con datos de ejemplo) o producción (de verdad).",
    why: "En desarrollo los mensajes sólo van a la lista del equipo y hay protecciones apagadas. En producción el servidor no arranca si falta algo importante: así no se abre mal configurado.",
    steps: [
      <>Completá antes todo lo demás de esta lista.</>,
      <>Cambiá el modo a producción y completá las claves (abajo). Para inventar una clave larga y aleatoria, podés usar un generador de contraseñas: 40 caracteres o más.</>,
      <>Reiniciá. Si falta algo, el servidor dice exactamente qué y no arranca (es a propósito).</>,
    ],
    env: [
      { name: "APP_ENV", example: "production", meaning: "El modo. «production» activa todas las protecciones." },
      { name: "VAULT_MASTER_KEY", example: "(40 caracteres al azar)", meaning: "Clave con la que se cifran contraseñas y secretos guardados. Si se pierde, no se pueden leer." },
      { name: "METRICS_TOKEN", example: "(30 caracteres al azar)", meaning: "Contraseña para ver las métricas técnicas del servidor." },
      { name: "STATS_PSEUDONYM_SECRET", example: "(30 caracteres al azar)", meaning: "Clave para que las estadísticas públicas no identifiquen a nadie." },
      { name: "CAPTCHA_SITE_KEY", example: "0x4AAAAAAA…", meaning: "El «no soy un robot» del alta (Cloudflare Turnstile, gratis). Se saca en dash.cloudflare.com → Turnstile." },
      { name: "CAPTCHA_SECRET", example: "0x4AAAAAAA…", meaning: "La clave secreta de ese mismo captcha." },
      { name: "LOAD_DEMO_DATA", example: "0", meaning: "Que no se carguen datos de ejemplo." },
    ],
    warning: "Guardá estas claves en un lugar seguro, fuera del servidor (un gestor de contraseñas). Si se pierde VAULT_MASTER_KEY, se pierden los secretos guardados.",
  },
  mail: {
    what: "El servicio que manda los mails: el enlace para entrar, avisos, resúmenes y facturas.",
    why: "Sin mail nadie puede entrar a la web con enlace, y no llegan los avisos.",
    needs: ["Una cuenta en un servicio de envío. Brevo tiene un plan gratis de 300 mails por día; también sirve Google Workspace o el de tu proveedor de hosting."],
    steps: [
      <>En Brevo: creá la cuenta, entrá a «SMTP y API» y generá una «clave SMTP». Anotá el servidor, el usuario y esa clave.</>,
      <>Agregá tu dominio en Brevo y copiá los registros que te pide (SPF y DKIM) en el panel de tu dominio: así tus mails no van a spam.</>,
      <>Completá la configuración (abajo), reiniciá y probá pidiendo un enlace para entrar.</>,
    ],
    env: [
      { name: "SMTP_HOST", example: "smtp-relay.brevo.com", meaning: "El servidor de envío (con Google Workspace: smtp.gmail.com)." },
      { name: "SMTP_PORT", example: "587", meaning: "El puerto. Casi siempre 587." },
      { name: "SMTP_SECURE", example: "false", meaning: "Dejalo en false con el puerto 587 (la conexión se cifra igual)." },
      { name: "SMTP_USER", example: "tu-cuenta@sinhumo.com.ar", meaning: "El usuario que te da el servicio." },
      { name: "SMTP_PASS", example: "xsmtpsib-…", meaning: "La clave SMTP (no la contraseña de tu cuenta). En Gmail, una «contraseña de aplicación»." },
      { name: "MAIL_FROM", example: "Sin Humo <hola@sinhumo.com.ar>", meaning: "Quién figura como remitente. Tiene que ser de tu dominio." },
    ],
  },
  whatsapp: {
    what: "Que las personas puedan reenviarle mensajes a Sin Humo por WhatsApp y recibir la respuesta ahí mismo.",
    why: "Es por donde más circulan las cadenas y por donde más se usa el servicio. Es opcional, pero muy recomendable.",
    needs: [
      "Una cuenta de Meta Business verificada (business.facebook.com).",
      "Un número de teléfono que no esté usado en WhatsApp común (puede ser una línea nueva).",
      "La dirección pública con HTTPS lista.",
    ],
    steps: [
      <>Entrá a developers.facebook.com → «Crear app» → tipo «Empresa» → agregá el producto «WhatsApp».</>,
      <>En «WhatsApp → Configuración de la API», agregá tu número y copiá el «Identificador del número de teléfono».</>,
      <>Creá un «usuario del sistema» en la configuración del negocio y generá un token permanente con permiso whatsapp_business_messaging.</>,
      <>En «WhatsApp → Configuración → Webhook» poné la dirección <code>https://TU-DOMINIO/webhooks/whatsapp</code>. Como «token de verificación» inventá una palabra larga y usá la misma en WHATSAPP_VERIFY_TOKEN. Suscribite al campo «messages».</>,
      <>En «Configuración de la app → Básica» copiá la «clave secreta de la app».</>,
      <>Completá la configuración (abajo), reiniciá y mandale «hola» al número desde tu teléfono.</>,
    ],
    env: [
      { name: "WHATSAPP_TOKEN", example: "EAAG…", meaning: "El token permanente del usuario del sistema." },
      { name: "WHATSAPP_PHONE_NUMBER_ID", example: "123456789012345", meaning: "El identificador del número (no es el número de teléfono)." },
      { name: "WHATSAPP_VERIFY_TOKEN", example: "una-palabra-larga-que-inventes", meaning: "La misma palabra que pusiste en el webhook de Meta." },
      { name: "WHATSAPP_APP_SECRET", example: "a1b2c3…", meaning: "La clave secreta de la app: sirve para comprobar que los mensajes vienen de Meta." },
      { name: "WHATSAPP_PUBLIC_NUMBER", example: "+54 9 11 5555-0000", meaning: "El número, para el botón «Abrir WhatsApp» con el que las personas vinculan su cuenta." },
    ],
    warning: "Meta cobra las conversaciones que inicia la empresa (avisos). Responder a quien escribió primero no tiene costo dentro de las 24 horas.",
  },
  telegram: {
    what: "Lo mismo que WhatsApp, pero por Telegram: un bot al que se le reenvían mensajes.",
    why: "Es gratis y se configura en cinco minutos.",
    needs: ["Una cuenta de Telegram.", "La dirección pública con HTTPS lista."],
    steps: [
      <>En Telegram, buscá @BotFather, escribile /newbot y seguí los pasos: un nombre (por ejemplo, «Sin Humo») y un usuario que termine en «bot» (por ejemplo, SinHumoBot).</>,
      <>BotFather te da un token del estilo 123456789:ABC-DEF… Copialo en TELEGRAM_BOT_TOKEN.</>,
      <>Inventá una palabra larga para TELEGRAM_SECRET_TOKEN (sirve para comprobar que los mensajes vienen de Telegram).</>,
      <>Reiniciá y abrí esta dirección en el navegador, reemplazando TOKEN, TU-DOMINIO y SECRETO: <code>https://api.telegram.org/botTOKEN/setWebhook?url=https://TU-DOMINIO/webhooks/telegram&secret_token=SECRETO</code>. Tiene que decir «Webhook was set».</>,
      <>Mandale «hola» al bot.</>,
    ],
    env: [
      { name: "TELEGRAM_BOT_TOKEN", example: "123456789:ABC-DEF1234ghIkl", meaning: "El token que te dio BotFather." },
      { name: "TELEGRAM_SECRET_TOKEN", example: "otra-palabra-larga", meaning: "La palabra que inventaste para el paso del webhook." },
      { name: "TELEGRAM_BOT_USERNAME", example: "SinHumoBot", meaning: "El usuario del bot, sin @, para el botón «Abrir Telegram»." },
    ],
  },
  cobros: {
    what: "Cobrar los planes pagos con tarjeta, débito o dinero en cuenta.",
    why: "Hoy los cobros son de prueba: nadie puede pagar un plan de verdad.",
    needs: ["Una cuenta de Mercado Pago a nombre de la empresa, con las credenciales de producción (mercadopago.com.ar/developers → Tus integraciones)."],
    steps: [
      <>Esta conexión todavía no está programada: hace falta sumar el adaptador de Mercado Pago (el resto del sistema ya está preparado para usarlo).</>,
      <>Cuando tengas la cuenta, avisá: con las credenciales se conecta y se prueba con una compra real de monto bajo.</>,
    ],
  },
  facturas: {
    what: "Emitir la factura electrónica de cada cobro en ARCA (ex AFIP).",
    why: "Es obligatorio facturar cada venta. Hoy las facturas se generan pero no se informan a ARCA.",
    needs: [
      "Clave fiscal nivel 3 del CUIT de la empresa.",
      "Un certificado digital para «web services» (se tramita en ARCA → Administración de certificados digitales).",
      "Un punto de venta de tipo «Factura electrónica – Web Services».",
    ],
    steps: [
      <>Tramitá el certificado y el punto de venta (tu contador/a lo sabe hacer).</>,
      <>Esta conexión todavía no está programada: con el certificado se conecta y se prueba primero en el ambiente de homologación de ARCA.</>,
    ],
    env: [
      { name: "SELLER_TAX_CONDITION", example: "responsable_inscripto", meaning: "Tu condición frente al IVA (responsable_inscripto o monotributo): define si se emite factura A/B o C." },
      { name: "SELLER_POINT_OF_SALE", example: "3", meaning: "El número del punto de venta de web services." },
    ],
  },
  planes: {
    what: "Los planes que se ofrecen y sus precios.",
    steps: [
      <>Revisá precios, límites y funciones en <Link to="/admin/planes">Planes</Link>.</>,
      <>Un precio nuevo vale para las suscripciones nuevas; quien ya paga sigue con lo que contrató.</>,
    ],
  },
  copias: {
    what: "Copias diarias de toda la base, cifradas, guardadas fuera del servidor.",
    why: "Si se rompe o se pierde el servidor, con la copia se recupera todo. Sin copia, se pierde todo.",
    needs: ["Un lugar para guardarlas, idealmente en otro proveedor: por ejemplo Cloudflare R2 (10 GB gratis) o Amazon S3."],
    steps: [
      <>En Cloudflare: R2 → crear un «bucket» (por ejemplo, sinhumo-copias) → «Administrar tokens de API de R2» → crear un token con permiso de lectura y escritura. Anotá el ID de clave de acceso, la clave secreta y la dirección («endpoint»).</>,
      <>Inventá una frase de cifrado larga y guardala en un gestor de contraseñas, <strong>fuera del servidor</strong>: sin ella, las copias no se pueden abrir.</>,
      <>Completá la configuración (abajo) y reiniciá. En <Link to="/admin/copias">Copias de seguridad</Link> tocá «Hacer una copia» y después «Verificar»: tiene que decir «Se restaura bien».</>,
    ],
    env: [
      { name: "BACKUP_PASSPHRASE", example: "una frase larga que sólo sepa el equipo 2027", meaning: "Con esta frase se cifran las copias. Al menos 24 caracteres." },
      { name: "BACKUP_S3_BUCKET", example: "sinhumo-copias", meaning: "El nombre del bucket." },
      { name: "BACKUP_S3_ENDPOINT", example: "https://abc123.r2.cloudflarestorage.com", meaning: "La dirección que te da Cloudflare (o el proveedor que uses)." },
      { name: "BACKUP_S3_REGION", example: "auto", meaning: "En R2, «auto». En Amazon, la región (por ejemplo, sa-east-1)." },
      { name: "BACKUP_S3_ACCESS_KEY_ID", example: "a1b2c3…", meaning: "El ID de la clave de acceso." },
      { name: "BACKUP_S3_SECRET_ACCESS_KEY", example: "x9y8z7…", meaning: "La clave secreta de acceso." },
    ],
  },
  equipo: {
    what: "Las cuentas que administran la plataforma.",
    why: "Si una sola cuenta tiene acceso y esa persona pierde el mail o se va, nadie más puede administrar.",
    steps: [
      <>Pedile a otra persona de confianza que entre una vez a Sin Humo con su mail.</>,
      <>En <Link to="/admin/personas">Personas</Link>, buscala por su mail, tocá «Gestionar», elegí «Administrador de la plataforma» y «Dar el rol».</>,
      <>Para el resto del equipo, dales sólo lo que necesitan: «Verificador», «Soporte» o «Gestión del negocio».</>,
    ],
  },
  catalogo: {
    what: "Los medios que Sin Humo sigue y sus «feeds»: la lista de notas nuevas que publica cada sitio (RSS).",
    why: "Sin feeds activos no entran notas nuevas: comparar fuentes y la credibilidad se quedan con datos viejos.",
    steps: [
      <>
        Lo más rápido: en <Link to="/admin/medios">Medios</Link>, abrí «Agregar medios conocidos», marcá los que quieras (diarios nacionales, provinciales, agencias,
        verificadores…) y tocá «Cargar en el catálogo». Sus feeds ya están comprobados.
      </>,
      <>Para uno que no esté en esa lista, buscá su feed: suele estar en <code>https://SITIO/rss</code>, <code>https://SITIO/feed</code> o en un ícono naranja de RSS al pie de la página.</>,
      <>En <Link to="/admin/medios">Medios</Link>, elegí el medio (o creá uno nuevo), pegá la dirección del feed en «Dirección de un feed nuevo» y tocá «Agregar feed».</>,
      <>Para cargar muchos medios de una vez, usá <Link to="/admin/catalogo">Importar catálogo</Link> con un archivo CSV.</>,
    ],
  },
  temas: {
    what: "Los temas con los que se ordenan las notas (tarifas de gas, inflación, elecciones…) y las palabras que los identifican.",
    steps: [
      <>En <Link to="/admin/temas">Temas</Link> revisá que estén los que te importan. Ejemplo: tema «tarifas de luz», palabras clave «tarifa de luz, EDENOR, EDESUR, ENRE».</>,
    ],
  },
};

/** El mismo texto para las dos guías de legales. */
export const guideFor = (checkId: string): Guide | undefined => SETUP_GUIDES[checkId.startsWith("legal-") ? "legal" : checkId];

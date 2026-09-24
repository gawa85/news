/**
 * TEXTO DE CAPTURAS: el OCR lee TODO lo que hay en la pantalla, incluida la interfaz
 * (hora, batería, botones, contadores). Eso no es contenido y ensucia el análisis
 * (un "100%" o un "2,3 mil" no son cifras de la noticia). Reglas puras, sin proveedor.
 */

const STATUS_BAR = [
  /^\d{1,2}:\d{2}(\s?[ap]\.?\s?m\.?)?$/i, // hora
  /^\d{1,3}\s?%$/, // batería
  /^(4g|5g|lte|3g|h\+|e|wi-?fi|vo\s?lte)(\s+(4g|5g|lte|3g))*$/i,
];

const UI_WORDS = new Set([
  "me gusta", "responder", "compartir", "reenviar", "seguir", "siguiendo", "retuitear", "repostear", "repost", "citar",
  "ver traducción", "traducir publicación", "mostrar más", "ver más", "leer más", "comentar", "comentarios", "enviar", "guardar",
  "mensaje", "escribí un mensaje", "escribe un mensaje", "en línea", "escribiendo...", "reenviado", "reenviado muchas veces",
  "publicidad", "patrocinado", "suscribite", "suscribirse", "compartido", "like", "reply", "share", "follow", "following",
  "retweet", "quote", "translate post", "show more", "sponsored", "forwarded", "forwarded many times", "type a message",
]);

/**
 * Contadores y tiempos relativos: "2,3 mil", "15 k", "· 3 h", "hace 5 min", "12".
 * Un número suelto largo ("15.000", "2026") puede ser contenido: se deja.
 */
const COUNTER = /^[·•]?\s*(\d{1,3}|[\d.,]+\s?(k|m|mil|mill\.?)|\d+\s?(s|min|h|d|sem)|hace \d+\s?\w+)$/i;

/** La barra de estado está arriba: más abajo, un "300%" suelto puede ser el titular. */
const STATUS_BAR_LINES = 4;

export function cleanScreenshotText(raw: string): string {
  let seen = 0;
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => {
      if (!l) return true; // se conservan los cortes de párrafo (se colapsan después)
      if (seen++ < STATUS_BAR_LINES && STATUS_BAR.some((re) => re.test(l))) return false;
      if (UI_WORDS.has(l.toLowerCase().replace(/[.:!]+$/, ""))) return false;
      if (COUNTER.test(l)) return false;
      return l.replace(/[^\p{L}\p{N}]/gu, "").length > 0; // íconos sueltos, flechas, separadores
    });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

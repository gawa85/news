/**
 * HTML → texto en TIEMPO LINEAL. Lo usan el archivo de notas, el mail entrante, los feeds y las
 * redes: todo HTML que manda cualquiera. Con expresiones regulares ingenuas, una página armada
 * (50.000 "<" sin ">", "<!--" sin cerrar, "<script>" repetido) tardaba segundos: una forma
 * barata de trabar el servidor. Acá cada carácter se mira una cantidad acotada de veces.
 */

/** Etiquetas cuyo contenido no es texto para leer. */
const SKIP = new Set(["script", "style", "noscript", "template", "svg", "iframe", "object"]);
/** Etiquetas que cortan línea. */
const BLOCK = new Set(["br", "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "blockquote", "article", "section", "header", "footer", "ul", "ol", "table", "hr"]);

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", "#39": "'",
  ntilde: "ñ", iexcl: "¡", iquest: "¿", laquo: "«", raquo: "»", ordm: "º", ordf: "ª", deg: "°", middot: "·", bull: "•",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", euro: "€", copy: "©", reg: "®", trade: "™",
  sect: "§", para: "¶", times: "×", divide: "÷", plusmn: "±", sup2: "²", sup3: "³", frac12: "½", frac14: "¼", frac34: "¾",
  cent: "¢", pound: "£", yen: "¥", micro: "µ", szlig: "ß", aelig: "æ", oslash: "ø",
};

/**
 * Letras con tilde, diéresis, circunflejo…: "&aacute;", "&Ouml;", "&atilde;", "&ccedil;".
 * Se arman todas (en mayúscula y minúscula) en vez de listarlas: sin esto quedaba "inflaci&oacute;n"
 * o "L&ouml;wy" en las notas.
 */
const LETTERS: Record<string, string> = (() => {
  const marks: Record<string, string> = { acute: "\u0301", grave: "\u0300", circ: "\u0302", uml: "\u0308", tilde: "\u0303", cedil: "\u0327", ring: "\u030a" };
  const out: Record<string, string> = {};
  for (const base of "aeiouyncAEIOUYNC") {
    for (const [name, mark] of Object.entries(marks)) {
      const ch = (base + mark).normalize("NFC");
      if (ch.length === 1) out[base + name] = ch;
    }
  }
  return out;
})();

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (all, e: string) => {
    if (LETTERS[e] !== undefined) return LETTERS[e]!;
    const k = e.toLowerCase();
    if (ENTITIES[k] !== undefined) return ENTITIES[k]!;
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : k.startsWith("#") ? parseInt(k.slice(1), 10) : NaN;
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
}

/** Texto visible (un bloque por línea) y título. Sin scripts, estilos ni comentarios. */
export function htmlToText(html: string): { title?: string; text: string } {
  const lower = html.toLowerCase();
  const out: string[] = [];
  let title: string | undefined;
  let i = 0;
  let nextGt = -2; // posición del próximo ">" (se reusa: no se vuelve a buscar hacia atrás)
  const closeOf = (name: string, from: number) => {
    const at = lower.indexOf(`</${name}`, from);
    if (at === -1) return { content: html.length, after: html.length };
    const gt = lower.indexOf(">", at);
    return { content: at, after: gt === -1 ? html.length : gt + 1 };
  };
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out.push(html.slice(i));
      break;
    }
    out.push(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) break; // comentario sin cerrar: el resto no se muestra
      i = end + 3;
      continue;
    }
    if (nextGt !== -1 && nextGt <= lt) nextGt = html.indexOf(">", lt + 1);
    if (nextGt === -1) {
      out.push(html.slice(lt)); // ningún ">" más: el resto es texto
      break;
    }
    const m = /^\/?([a-zA-Z][a-zA-Z0-9-]{0,30})/.exec(html.slice(lt + 1, Math.min(nextGt, lt + 34)));
    if (!m) {
      out.push("<"); // "a < b": no es una etiqueta
      i = lt + 1;
      continue;
    }
    const name = m[1]!.toLowerCase();
    const closing = html[lt + 1] === "/";
    const tagEnd = nextGt + 1;
    if (!closing && SKIP.has(name)) {
      i = closeOf(name, tagEnd).after;
      out.push(" ");
      continue;
    }
    if (!closing && name === "title") {
      const c = closeOf("title", tagEnd);
      title ??= decodeEntities(html.slice(tagEnd, c.content)).replace(/\s+/g, " ").trim() || undefined;
      i = c.after;
      continue;
    }
    out.push(BLOCK.has(name) ? "\n" : " ");
    i = tagEnd;
  }
  const text = decodeEntities(out.join(""))
    .split("\n")
    .map((l) => l.replace(/[ \t\r\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title, text };
}

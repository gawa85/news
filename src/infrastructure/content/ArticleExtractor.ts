import { decodeEntities, htmlToText } from "../text/HtmlText";

export interface ExtractedArticle {
  title?: string;
  text: string;
  siteName?: string;
  author?: string;
  publishedAt?: Date;
  /** De dónde salió el cuerpo (para saber qué tan confiable es la extracción). */
  via: "json-ld" | "article" | "paragraphs" | "none";
}

const MAX_TEXT = 30_000;
const clean = (s: string) => s.replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

/** Recorre las etiquetas `<tag …>…</tag>` con indexOf (sin expresiones que se traben con HTML armado). */
function blocks(html: string, tag: string, max = 400): { attrs: string; inner: string }[] {
  const lower = html.toLowerCase();
  const out: { attrs: string; inner: string }[] = [];
  let i = 0;
  while (out.length < max) {
    const start = lower.indexOf(`<${tag}`, i);
    if (start === -1) break;
    const after = lower[start + tag.length + 1];
    if (after !== ">" && after !== " " && after !== "\n" && after !== "\t" && after !== "\r") {
      i = start + 1;
      continue;
    }
    const gt = lower.indexOf(">", start);
    if (gt === -1) break;
    const end = lower.indexOf(`</${tag}`, gt);
    if (end === -1) break;
    out.push({ attrs: html.slice(start + tag.length + 1, gt), inner: html.slice(gt + 1, end) });
    i = end + tag.length + 2;
  }
  return out;
}

/** El contenido de `<meta property|name="…" content="…">` (no tienen cierre: se recorren aparte). */
/**
 * El HTML sin `<script>`, `<style>`, `<noscript>` ni `<template>`: muchas páginas repiten la nota
 * adentro de su JavaScript ("ó", "<\/a>"), y esos "párrafos" no son texto para leer.
 */
function withoutScripts(html: string): string {
  const lower = html.toLowerCase();
  let out = "";
  let i = 0;
  for (;;) {
    let next = -1;
    let tag = "";
    for (const t of ["script", "style", "noscript", "template"]) {
      const at = lower.indexOf(`<${t}`, i);
      if (at !== -1 && (next === -1 || at < next)) (next = at), (tag = t);
    }
    if (next === -1) return out + html.slice(i);
    out += html.slice(i, next);
    const end = lower.indexOf(`</${tag}`, next);
    if (end === -1) return out;
    const gt = lower.indexOf(">", end);
    i = gt === -1 ? html.length : gt + 1;
  }
}

function meta(html: string, prop: string): string | undefined {
  const lower = html.toLowerCase();
  const wanted = new RegExp(`(?:property|name)\\s*=\\s*["']${prop}["']`, "i");
  let i = 0;
  for (let n = 0; n < 300; n++) {
    const start = lower.indexOf("<meta", i);
    if (start === -1) return undefined;
    const gt = lower.indexOf(">", start);
    if (gt === -1) return undefined;
    const tag = html.slice(start, gt + 1);
    if (wanted.test(tag)) {
      const c = tag.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
      const v = c?.[1] ?? c?.[2];
      if (v) return decodeEntities(v).trim();
    }
    i = gt + 1;
  }
  return undefined;
}

type Json = Record<string, unknown>;

/** Los objetos de un JSON-LD (puede venir suelto, en un array o dentro de "@graph"). */
function jsonLdObjects(value: unknown): Json[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdObjects);
  if (!value || typeof value !== "object") return [];
  const o = value as Json;
  return [o, ...jsonLdObjects(o["@graph"])];
}

const isArticleType = (t: unknown) => (Array.isArray(t) ? t : [t]).some((x) => typeof x === "string" && /Article|Reportage|BlogPosting/i.test(x));
const nameOf = (v: unknown): string | undefined =>
  typeof v === "string" ? v : Array.isArray(v) ? nameOf(v[0]) : v && typeof v === "object" ? (typeof (v as Json).name === "string" ? ((v as Json).name as string) : undefined) : undefined;

/**
 * El CUERPO de una nota, sin menús, publicidad ni "notas relacionadas" (que meterían humo que no
 * es de la nota). En orden de confianza:
 *  1. El texto que el propio medio publica para los buscadores (JSON-LD `articleBody`).
 *  2. La etiqueta `<article>` más larga.
 *  3. Los párrafos largos de la página.
 */
export function extractArticle(html: string): ExtractedArticle {
  const title = meta(html, "og:title") ?? htmlToText(`<title>${blocks(html, "title", 1)[0]?.inner ?? ""}</title>`).title;
  const siteName = meta(html, "og:site_name");

  for (const s of blocks(html, "script", 200)) {
    if (!/application\/ld\+json/i.test(s.attrs)) continue;
    let data: unknown;
    try {
      data = JSON.parse(s.inner.trim());
    } catch {
      continue;
    }
    const art = jsonLdObjects(data).find((o) => isArticleType(o["@type"]) && typeof o.articleBody === "string" && (o.articleBody as string).trim().length > 200);
    if (art) {
      const date = typeof art.datePublished === "string" ? new Date(art.datePublished) : undefined;
      return {
        title: typeof art.headline === "string" ? decodeEntities(art.headline).trim() : title,
        text: clean(htmlToText(art.articleBody as string).text).slice(0, MAX_TEXT),
        siteName: nameOf(art.publisher) ?? siteName,
        author: nameOf(art.author),
        publishedAt: date && !Number.isNaN(date.getTime()) ? date : undefined,
        via: "json-ld",
      };
    }
  }

  const visible = withoutScripts(html);
  const article = blocks(visible, "article", 50)
    .map((a) => clean(htmlToText(a.inner).text))
    .sort((a, b) => b.length - a.length)[0];
  if (article && article.length > 300) return { title, siteName, text: article.slice(0, MAX_TEXT), via: "article" };

  const paragraphs = blocks(visible, "p", 400)
    .map((p) => clean(htmlToText(p.inner).text))
    .filter((p) => p.length >= 60);
  if (paragraphs.length) return { title, siteName, text: paragraphs.join("\n\n").slice(0, MAX_TEXT), via: "paragraphs" };
  return { title, siteName, text: "", via: "none" };
}

import type { Region } from "./common";

export interface Article {
  id: string;
  outletId: string;
  url: string;
  title: string;
  body: string;
  publishedAt: Date;
  /** Lugar donde se genera la noticia (no necesariamente donde está el medio). */
  region: Region;
  topic: string;
  authorId?: string;
}

/** Id ESTABLE de una nota a partir de su URL (sin parámetros): reingresar el feed no duplica. */
export function stableArticleId(url: string): string {
  const s = url.trim().toLowerCase().replace(/[#?].*$/, "");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `art_${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

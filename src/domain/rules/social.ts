/**
 * REDES: de qué plataforma es un link y cuál es su id (reglas puras).
 */
import type { SocialPlatform } from "../model";

const HOSTS: [RegExp, SocialPlatform][] = [
  [/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/, "youtube"],
  [/(^|\.)(twitter\.com|x\.com)$/, "x"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.watch)$/, "facebook"],
  [/(^|\.)(instagram\.com|instagr\.am)$/, "instagram"],
  [/(^|\.)(tiktok\.com)$/, "tiktok"],
  [/(^|\.)(t\.me|telegram\.me)$/, "telegram"],
  [/(^|\.)(threads\.net|threads\.com)$/, "threads"],
];

export function socialPlatformOf(url: URL): SocialPlatform {
  const host = url.hostname.toLowerCase();
  return HOSTS.find(([re]) => re.test(host))?.[1] ?? "web";
}

/** Id del video de YouTube en cualquiera de sus formatos (watch, youtu.be, shorts, embed, live). */
export function youtubeVideoId(url: URL): string | undefined {
  const id = url.hostname.endsWith("youtu.be") ? url.pathname.slice(1).split("/")[0] : url.searchParams.get("v") ?? /^\/(?:shorts|embed|live|v)\/([^/?]+)/.exec(url.pathname)?.[1];
  return id && /^[\w-]{11}$/.test(id) ? id : undefined;
}

/** Id del posteo en X ("/usuario/status/123…"). */
export function xStatusId(url: URL): string | undefined {
  return /\/status(?:es)?\/(\d{5,25})/.exec(url.pathname)?.[1];
}

/**
 * ¿El mensaje es "un link a una red" (con, a lo sumo, un comentario corto)? Entonces lo que
 * hay que analizar es el posteo, no el mensaje. Devuelve el link.
 */
export function sharedSocialLink(text: string): URL | undefined {
  const links = text.match(/https?:\/\/[^\s<>"]+/g) ?? [];
  if (links.length !== 1) return undefined;
  const rest = text.replace(links[0]!, "").trim();
  if (rest.length > 140) return undefined;
  try {
    const url = new URL(links[0]!);
    return socialPlatformOf(url) === "web" ? undefined : url;
  } catch {
    return undefined;
  }
}

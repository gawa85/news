import { socialPlatformOf } from "./social";

/**
 * Si el mensaje es un LINK A UNA NOTA (un solo link, casi sin texto alrededor, y no de una red
 * social), lo devuelve: lo que la persona quiere es que se analice la nota, no el link.
 */
export function sharedNewsLink(text: string): URL | undefined {
  const links = text.match(/https?:\/\/[^\s<>"]+/g) ?? [];
  if (links.length !== 1) return undefined;
  if (text.replace(links[0]!, "").trim().length > 140) return undefined;
  try {
    const url = new URL(links[0]!);
    return socialPlatformOf(url) === "web" ? url : undefined;
  } catch {
    return undefined;
  }
}

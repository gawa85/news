import type { SocialPlatform, SocialPost } from "../model";

/**
 * Lee un posteo de una red (API oficial, oEmbed, metadatos públicos…). Cada adaptador dice
 * qué links sabe leer; si no puede con uno en particular, rechaza y se prueba el siguiente.
 */
export interface ISocialSource {
  readonly id: string;
  canRead(url: URL, platform: SocialPlatform): boolean;
  read(url: URL, platform: SocialPlatform): Promise<SocialPost>;
}

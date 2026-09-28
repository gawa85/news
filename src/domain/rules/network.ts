/**
 * Direcciones de red (reglas puras). Una dirección que elige una persona (webhook, página a
 * archivar) no puede apuntar a la red interna, al propio servidor ni a los metadatos de la nube.
 */

/** 4 = IPv4, 6 = IPv6, 0 = no es una IP (es un nombre). */
export function ipKind(s: string): 0 | 4 | 6 {
  const v = s.replace(/^\[|\]$/g, "");
  if (/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(v)) return 4;
  if (v.includes(":") && /^[0-9a-f:.]+$/i.test(v)) return 6;
  return 0;
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
];

/** ¿Es una dirección de internet pública? (no interna, local, de enlace, multicast ni reservada) */
export function isPublicAddress(ip: string): boolean {
  const kind = ipKind(ip);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    return !V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits)));
  }
  if (kind === 6) {
    const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (v === "::" || v === "::1") return false;
    const first = parseInt(v.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 privadas
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 de enlace
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (v.startsWith("64:ff9b:") || v.startsWith("2001:db8:")) return false; // traducción / documentación
    return true;
  }
  return false;
}


/** Nombres que siempre son la propia máquina o la red local. */
export function isLocalHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || (ipKind(h) !== 0 && !isPublicAddress(h));
}

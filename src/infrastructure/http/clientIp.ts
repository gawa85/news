/**
 * IP REAL de quien llama. Detrás de un proxy (Caddy, nginx, un balanceador) el socket trae la
 * IP del proxy y la real viene en X-Forwarded-For. Pero ese encabezado lo puede escribir
 * cualquiera: sólo se le cree si el pedido llegó desde un proxy de confianza, y se toma la
 * primera dirección (de derecha a izquierda) que NO es de un proxy de confianza.
 */
import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";

const strip = (ip: string) => ip.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "").replace(/^\[|\]$/g, "");

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
}

/** ¿La IP está en la lista? (direcciones exactas o rangos IPv4 "10.0.0.0/8") */
export function inTrustedList(ip: string, trusted: string[]): boolean {
  const a = strip(ip);
  return trusted.some((entry) => {
    const [base = "", bits] = entry.trim().split("/");
    if (bits === undefined) return strip(base) === a;
    if (isIP(a) !== 4 || isIP(base) !== 4) return false;
    const n = Number(bits);
    return n === 0 || v4ToInt(a) >>> (32 - n) === v4ToInt(base) >>> (32 - n);
  });
}

export function clientIp(req: IncomingMessage, trustedProxies: string[]): string | undefined {
  const remote = req.socket.remoteAddress ? strip(req.socket.remoteAddress) : undefined;
  if (!remote || trustedProxies.length === 0 || !inTrustedList(remote, trustedProxies)) return remote;
  const header = String(req.headers["x-forwarded-for"] ?? "");
  const chain = header.split(",").map(strip).filter((ip) => isIP(ip) !== 0);
  for (let i = chain.length - 1; i >= 0; i--) if (!inTrustedList(chain[i]!, trustedProxies)) return chain[i];
  return chain[0] ?? remote;
}

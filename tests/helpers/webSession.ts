import type { AddressInfo } from "node:net";
import { httpApiDeps } from "../../src/composition/platform";
import { createHttpApi } from "../../src/infrastructure/http/HttpApi";
import { withRoles, type testPlatform } from "./platform";

const ORIGIN = "https://sinhumo.example";
const tokenFrom = (text: string) => text.match(/token=([\w-]+)/)![1]!;

/** Levanta la API HTTP de una plataforma de prueba y permite entrar como cualquier persona (enlace mágico). */
export async function startWebApi(t: Awaited<ReturnType<typeof testPlatform>>) {
  const server = createHttpApi(httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" } }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const login = async (email: string, roles: string[] = []) => {
    t.clock.advance(3_600_001); // (el freno contra el abuso admite 5 altas por hora desde la misma IP)
    await fetch(`${base}/auth/magic-link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    const r = await fetch(`${base}/auth/magic?token=${tokenFrom(t.mail.sent.at(-1)!.text)}`, { redirect: "manual" });
    const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
    const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
      fetch(`${base}${path}`, { ...init, headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...init.headers } });
    const me = (await (await call("/v1/me")).json()) as { id: string };
    if (roles.length) await withRoles(t, me.id, roles);
    return Object.assign(call, { userId: me.id });
  };

  return { base, login, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

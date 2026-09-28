import { ApiError } from "./ApiError";

export type Fetch = typeof fetch;

/**
 * Pedido JSON al servidor (mismo origen: la cookie de sesión viaja sola). Lo comparten los
 * adaptadores HTTP de la web; los errores llegan como ApiError (código, plan sugerido, espera, captcha).
 */
export async function jsonRequest<T>(fetchFn: Fetch, base: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetchFn(`${base}${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const e = (data ?? {}) as Record<string, unknown>;
    const retry = Number(res.headers.get("retry-after") ?? "");
    throw new ApiError(
      res.status,
      String(e.error ?? `Error ${res.status}`),
      e.code as string | undefined,
      e.upgradeHint as string | undefined,
      Number.isFinite(retry) && retry > 0 ? retry : undefined,
      e.captcha as ApiError["captcha"],
    );
  }
  return data as T;
}

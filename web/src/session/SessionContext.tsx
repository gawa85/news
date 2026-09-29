import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApi } from "../api/ApiContext";
import { ApiError } from "../api/ApiError";
import type { Me } from "../api/types";

interface Session {
  /** undefined = sin sesión; null = todavía cargando (o no se pudo saber: ver `problem`). */
  me: Me | undefined | null;
  /** No se pudo saber quién es (servidor ocupado o caído, sin conexión). NO es "no hay sesión". */
  problem?: unknown;
  refresh(): Promise<void>;
  logout(everywhere?: boolean): Promise<void>;
  /** ¿El plan incluye esta funcionalidad? */
  can(feature: string): boolean;
  /** ¿Su rol tiene este permiso? (para mostrar el backoffice; el servidor controla igual) */
  has(permission: string): boolean;
}

const SessionContext = createContext<Session | null>(null);

/** Quién está conectado (una sola consulta a /v1/me, compartida por toda la web). */
export function SessionProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [me, setMe] = useState<Me | undefined | null>(null);
  const [problem, setProblem] = useState<unknown>();

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
      setProblem(undefined);
    } catch (e) {
      // Sólo "tenés que entrar" significa que no hay sesión (lo resuelve api.me). Cualquier otra
      // cosa (demasiados pedidos, servidor caído, sin conexión) se muestra: no se manda a "Entrar".
      setProblem(e);
      if (e instanceof ApiError && e.retryAfterSeconds) setTimeout(() => void refresh(), Math.min(e.retryAfterSeconds, 60) * 1000);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<Session>(
    () => ({
      me,
      problem,
      refresh,
      logout: async (everywhere) => {
        await api.logout(everywhere);
        setMe(undefined);
      },
      can: (feature) => !!me?.plan.features.includes(feature),
      has: (permission) => !!me?.permissions?.includes(permission),
    }),
    [api, me, problem, refresh],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("Falta <SessionProvider>.");
  return s;
}

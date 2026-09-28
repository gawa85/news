import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApi } from "../api/ApiContext";
import type { Me } from "../api/types";

interface Session {
  /** undefined = sin sesión; null = todavía cargando. */
  me: Me | undefined | null;
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

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch {
      setMe(undefined);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<Session>(
    () => ({
      me,
      refresh,
      logout: async (everywhere) => {
        await api.logout(everywhere);
        setMe(undefined);
      },
      can: (feature) => !!me?.plan.features.includes(feature),
      has: (permission) => !!me?.permissions?.includes(permission),
    }),
    [api, me, refresh],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("Falta <SessionProvider>.");
  return s;
}

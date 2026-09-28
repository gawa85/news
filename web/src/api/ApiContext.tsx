import { createContext, useContext, type ReactNode } from "react";
import type { SinHumoApi } from "./SinHumoApi";

/** La API se inyecta (DIP): la real en main.tsx, una falsa en las pruebas. */
const ApiContext = createContext<SinHumoApi | null>(null);

export function ApiProvider({ api, children }: { api: SinHumoApi; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): SinHumoApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("Falta <ApiProvider>.");
  return api;
}

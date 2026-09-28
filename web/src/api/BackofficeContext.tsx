import { createContext, useContext, type ReactNode } from "react";
import type { BackofficeApi } from "./BackofficeApi";

/** El puerto del backoffice se inyecta aparte (DIP + ISP): la real en main.tsx, una falsa en las pruebas. */
const BackofficeContext = createContext<BackofficeApi | null>(null);

export function BackofficeProvider({ api, children }: { api: BackofficeApi; children: ReactNode }) {
  return <BackofficeContext.Provider value={api}>{children}</BackofficeContext.Provider>;
}

export function useBackoffice(): BackofficeApi {
  const api = useContext(BackofficeContext);
  if (!api) throw new Error("Falta <BackofficeProvider>.");
  return api;
}

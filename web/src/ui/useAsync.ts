import { useCallback, useEffect, useRef, useState } from "react";

/** Estado de una llamada: cargando, error o datos. Evita actualizar un componente que ya se fue. */
export function useAsync<T>(run: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ loading: boolean; error?: unknown; data?: T }>({ loading: true });
  const alive = useRef(true);
  // `deps` decide cuándo volver a cargar (como en useEffect).
  const load = useCallback(run, deps);

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const data = await load();
      if (alive.current) setState({ loading: false, data });
    } catch (error) {
      if (alive.current) setState({ loading: false, error });
    }
  }, [load]);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  return { ...state, reload, setData: (data: T) => setState({ loading: false, data }) };
}

/** Una acción que se dispara (enviar un formulario): pendiente, error y resultado. */
export function useAction<A extends unknown[], T>(fn: (...args: A) => Promise<T>) {
  const [state, setState] = useState<{ pending: boolean; error?: unknown; result?: T }>({ pending: false });
  const run = useCallback(
    async (...args: A): Promise<T | undefined> => {
      setState({ pending: true });
      try {
        const result = await fn(...args);
        setState({ pending: false, result });
        return result;
      } catch (error) {
        setState({ pending: false, error });
        return undefined;
      }
    },
    [fn],
  );
  return { ...state, run, reset: () => setState({ pending: false }) };
}

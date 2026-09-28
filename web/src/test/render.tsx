import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ApiProvider } from "../api/ApiContext";
import type { SinHumoApi } from "../api/SinHumoApi";
import { routes } from "../app/App";
import { SessionProvider } from "../session/SessionContext";

/** La web entera (rutas reales) con una API inyectada, arrancando en `path`. */
export function renderApp(api: SinHumoApi, path = "/") {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <ApiProvider api={api}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </ApiProvider>,
  );
  return { ...utils, router };
}

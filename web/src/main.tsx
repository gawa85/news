import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiProvider } from "./api/ApiContext";
import { HttpSinHumoApi } from "./api/HttpSinHumoApi";
import { BackofficeProvider } from "./api/BackofficeContext";
import { HttpBackofficeApi } from "./api/HttpBackofficeApi";
import { App } from "./app/App";
import { SessionProvider } from "./session/SessionContext";
import "./styles/tokens.css";
import "./styles/base.css";

// Composición: acá (y sólo acá) se elige la implementación real de la API.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ApiProvider api={new HttpSinHumoApi()}>
      <BackofficeProvider api={new HttpBackofficeApi()}>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BackofficeProvider>
    </ApiProvider>
  </StrictMode>,
);

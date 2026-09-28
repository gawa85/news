import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ApiError } from "../api/ApiError";
import { HttpSinHumoApi } from "../api/HttpSinHumoApi";
import { FakeApi, sampleMe } from "./FakeApi";
import { renderApp } from "./render";

describe("API por HTTP", () => {
  test("traduce los errores del servidor: código, plan sugerido, cuándo reintentar y captcha", async () => {
    const api = new HttpSinHumoApi("", async () =>
      new Response(JSON.stringify({ error: "Llegaste al límite de hoy.", code: "quota_exceeded", upgradeHint: "Disponible en el plan Personal.", captcha: { provider: "turnstile", siteKey: "k" } }), {
        status: 429,
        headers: { "retry-after": "120" },
      }),
    );
    const e = await api.analyze("x").catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ApiError);
    const err = e as ApiError;
    expect([err.status, err.code, err.upgradeHint, err.retryAfterSeconds, err.isLimit, err.needsBetterPlan]).toEqual([429, "quota_exceeded", "Disponible en el plan Personal.", 120, true, true]);
    expect(err.captcha?.siteKey).toBe("k");
  });

  test("sin sesión, /v1/me no es un error: es undefined; la cookie viaja sola (mismo origen)", async () => {
    let init: RequestInit | undefined;
    const api = new HttpSinHumoApi("", async (_u, i) => {
      init = i;
      return new Response(JSON.stringify({ error: "Falta la clave de API o la sesión.", code: "no_permission" }), { status: 403 });
    });
    expect(await api.me()).toBeUndefined();
    expect(init?.credentials).toBe("same-origin");
  });

  test("PATCH de preferencias manda el cuerpo como JSON", async () => {
    let sent: { method?: string; body?: string } = {};
    const api = new HttpSinHumoApi("", async (_u, i) => {
      sent = { method: i?.method, body: String(i?.body) };
      return new Response(JSON.stringify({ digest: "weekly" }));
    });
    await api.updatePreferences({ digest: "weekly" });
    expect(sent).toEqual({ method: "PATCH", body: JSON.stringify({ digest: "weekly" }) });
  });
});

describe("Acceso", () => {
  test("pedir el enlace al mail", async () => {
    const api = new FakeApi();
    renderApp(api, "/entrar");
    const user = userEvent.setup();
    expect(await screen.findByRole("link", { name: "Entrar con Google" })).toHaveAttribute("href", "/auth/google?next=%2Fanalizar");
    await user.type(screen.getByLabelText("Tu mail"), "ana@correo.example");
    await user.click(screen.getByRole("button", { name: "Mandame el enlace" }));
    expect(await screen.findByText("Revisá tu mail")).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "requestMagicLink")?.args[0]).toBe("ana@correo.example");
  });

  test("contraseña incorrecta: el error se explica; correcta: entra y va a analizar", async () => {
    const api = new FakeApi();
    renderApp(api, "/entrar");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Con contraseña" }));
    await user.type(screen.getByLabelText("Tu mail"), "ana@correo.example");
    await user.type(screen.getByLabelText("Contraseña"), "mala");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Mail o contraseña incorrectos.");
    await user.clear(screen.getByLabelText("Contraseña"));
    await user.type(screen.getByLabelText("Contraseña"), "correcta");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Analizar" })).toBeInTheDocument();
  });

  test("un enlace vencido vuelve con un aviso", async () => {
    renderApp(new FakeApi(), "/entrar?error=enlace");
    expect(await screen.findByText(/El enlace para entrar venció/)).toBeInTheDocument();
  });

  test("sin sesión, las pantallas privadas mandan a entrar (y recuerdan adónde volver)", async () => {
    const { router } = renderApp(new FakeApi(), "/cuenta");
    await screen.findByRole("heading", { level: 1, name: "Entrar a Sin Humo" });
    expect(router.state.location.search).toBe("?next=%2Fcuenta");
  });

  test("no vuelve a otro sitio después de entrar (next de afuera se ignora)", async () => {
    renderApp(new FakeApi(), "/entrar?next=//atacante.example");
    expect(await screen.findByRole("link", { name: "Entrar con Google" })).toHaveAttribute("href", "/auth/google?next=%2Fanalizar");
  });
});

describe("Analizar", () => {
  test("muestra el índice en número y palabras, el humo con su tipo y las señales; y pregunta si sirvió", async () => {
    const api = new FakeApi(sampleMe());
    renderApp(api, "/analizar");
    const user = userEvent.setup();
    expect(await screen.findByText("Te quedan 3 análisis hoy.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Texto o link"), "URGENTE: mañana cortan el agua.");
    await user.click(screen.getByRole("button", { name: "Analizar" }));
    const result = await screen.findByRole("region", { name: "Resultado" });
    expect(within(result).getByText("83")).toBeInTheDocument();
    expect(within(result).getByText("Casi todo humo")).toBeInTheDocument();
    expect(within(result).getByText("Alarmismo:")).toBeInTheDocument();
    expect(within(result).getByText("Pedido de reenvío:")).toBeInTheDocument();
    expect(within(result).getByText("Reenviado muchas veces")).toBeInTheDocument();

    await user.click(within(result).getByRole("button", { name: "No" }));
    await user.click(within(result).getByRole("button", { name: "Enviar" }));
    expect(await within(result).findByText(/el equipo va a revisar/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "feedback")?.args).toEqual(["an1", false, "se_equivoco"]);
  });

  test("sin texto, avisa en el campo; con el cupo agotado, sugiere el plan", async () => {
    const api = new FakeApi(sampleMe());
    api.analyzeResult = new ApiError(429, "Llegaste al máximo de 5 análisis por día.", "quota_exceeded", "Disponible en el plan Personal (ARS 4.990/mes).");
    renderApp(api, "/analizar");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Analizar" }));
    expect(screen.getByText("Pegá un texto o un link para analizar.")).toBeInTheDocument();
    expect(screen.getByLabelText("Texto o link")).toHaveAttribute("aria-invalid", "true");
    await user.type(screen.getByLabelText("Texto o link"), "hola");
    await user.click(screen.getByRole("button", { name: "Analizar" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Disponible en el plan Personal");
    expect(within(alert).getByRole("link", { name: "Ver planes" })).toHaveAttribute("href", "/planes");
  });
});

describe("Cuenta", () => {
  test("guardar preferencias y seguir un tema", async () => {
    const api = new FakeApi(sampleMe());
    renderApp(api, "/cuenta");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /Lectura fácil/ }));
    await user.selectOptions(screen.getByLabelText("Resumen de novedades"), "weekly");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Listo, guardamos tus preferencias.")).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "updatePreferences")?.args[0]).toMatchObject({ responseFormat: "easy_read", digest: "weekly" });

    await user.type(screen.getByLabelText("Seguir un tema"), "tarifas de gas");
    await user.click(screen.getByRole("button", { name: "Seguir" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Dejar de seguir tarifas de gas" })).toBeInTheDocument());
  });

  test("borrar la cuenta pide escribir la confirmación exacta", async () => {
    const api = new FakeApi(sampleMe());
    renderApp(api, "/cuenta");
    const user = userEvent.setup();
    await user.click(await screen.findByText("Borrar mi cuenta", { selector: "summary" }));
    const button = screen.getByRole("button", { name: "Borrar mi cuenta" });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/Para confirmar/), "BORRAR MIS DATOS");
    expect(button).toBeEnabled();
  });

  test("con términos nuevos, se aceptan desde el aviso", async () => {
    const api = new FakeApi(sampleMe({ pendingLegal: [{ id: "terms", title: "Términos y condiciones", version: "2026-10", url: "https://sinhumo.example/legal/terminos", summary: "Cambios en el uso de datos.", material: true, draft: false }] }));
    renderApp(api, "/analizar");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Leí y acepto" }));
    expect(api.calls.find((c) => c.method === "acceptLegal")?.args).toEqual(["terms", "2026-10"]);
  });
});

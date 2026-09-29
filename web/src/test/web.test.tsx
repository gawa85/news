import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ApiError } from "../api/ApiError";
import { HttpSinHumoApi } from "../api/HttpSinHumoApi";
import { FakeApi, sampleMe, sampleOrg } from "./FakeApi";
import { renderApp } from "./render";
import { FakeBackoffice } from "./FakeBackoffice";

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

  test("el captcha no se carga de entrada: aparece sólo cuando el servidor lo pide", async () => {
    const api = new FakeApi();
    api.demandCaptcha = true;
    renderApp(api, "/entrar");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Tu mail"), "ana@correo.example");
    expect(screen.queryByText("Verificación")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mandame el enlace" }));
    expect(await screen.findByText(/Confirmá que sos una persona y tocá de nuevo el botón/)).toBeInTheDocument();
    expect(screen.getByText("Verificación")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mandame el enlace" })).toBeDisabled();
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

describe("Ayuda, archivo y eventos", () => {
  test("abrir una consulta y verla en la lista", async () => {
    const api = new FakeApi(sampleMe());
    renderApp(api, "/ayuda");
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("¿Sobre qué es?"), "billing");
    await user.type(screen.getByLabelText("Contanos qué pasó"), "Me cobraron dos veces el plan.");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText(/Abrimos la consulta T-ABC123/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "openTicket")?.args[0]).toEqual({ text: "Me cobraron dos veces el plan.", category: "billing" });
    expect(await screen.findByText("Me cobraron dos veces el plan.", { selector: "summary strong" })).toBeInTheDocument();
  });

  test("el archivo es del plan Profesional; con el plan, guarda y verifica", async () => {
    renderApp(new FakeApi(sampleMe()), "/archivo");
    expect(await screen.findByText("El archivo viene con el plan Profesional.")).toBeInTheDocument();

    const api = new FakeApi(sampleMe({ plan: { ...sampleMe().plan, features: ["evidence_archive"] } }));
    renderApp(api, "/archivo");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Link de la nota"), "https://diario.example/nota");
    await user.click(screen.getByRole("button", { name: "Guardar copia" }));
    expect(await screen.findByText(/Guardamos la copia/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "capture")?.args).toEqual(["https://diario.example/nota", true]);
    await user.click(await screen.findByRole("button", { name: "Verificar que no se alteró" }));
    expect(await screen.findByText("Todo coincide: la copia no se alteró.")).toBeInTheDocument();
  });

  test("un evento se sigue sin cuenta: chequeos fijados y mensajes en vivo anunciados", async () => {
    const api = new FakeApi();
    renderApp(api, "/eventos/ABC234");
    expect(await screen.findByRole("heading", { level: 1, name: "Debate presidencial" })).toBeInTheDocument();
    expect(screen.getByText("FALSO: la inflación fue 3,7%.")).toBeInTheDocument();
    await waitFor(() => expect(api.emit).toBeDefined());
    api.emit!({ type: "message", message: { id: "m1", alias: "Participante 4F2A", text: "¿Alguien tiene el dato de desempleo?", links: [], flags: [], at: "2026-09-28T21:15:00Z", deleted: false } });
    api.emit!({ type: "presence", count: 42 });
    const chat = await screen.findByRole("region", { name: "Conversación" });
    expect(await within(chat).findByText("¿Alguien tiene el dato de desempleo?")).toBeInTheDocument();
    expect(within(chat).getByText("Participante 4F2A")).toBeInTheDocument();
    expect(screen.getByText(/42 personas mirando/)).toBeInTheDocument();
    expect(within(chat).getByRole("link", { name: "Entrá" })).toBeInTheDocument();
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

  test("cancelar el plan: dice hasta cuándo sigue, pide confirmar y se puede deshacer", async () => {
    const api = new FakeApi(
      sampleMe({
        plan: { id: "personal", name: "Personal", features: ["content_analysis"], limits: { analysesPerDay: 50, comparisonsPerMonth: 60, maxSourcesPerComparison: 8, maxIncludeUrls: 5, seats: 1 }, price: { amount: 4990, currency: "ARS", interval: "month" } },
        subscription: { status: "active", interval: "month", currentPeriodEnd: "2026-10-28T12:00:00Z", cancelAtPeriodEnd: false, managedByOrganization: false },
      }),
    );
    renderApp(api, "/cuenta");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancelar mi plan" }));
    expect(screen.getByRole("group", { name: "Confirmar la cancelación" })).toHaveTextContent(/hasta el 28 de oct\.? de 2026/);
    await user.click(screen.getByRole("button", { name: "Sí, cancelar" }));
    expect(await screen.findByText("Cancelaste tu plan")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Seguir con Personal" }));
    expect(await screen.findByRole("button", { name: "Cancelar mi plan" })).toBeInTheDocument();
    expect(api.calls.map((c) => c.method).filter((m) => /Subscription/.test(m))).toEqual(["cancelSubscription", "resumeSubscription"]);
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

const proMe = () =>
  sampleMe({
    plan: {
      id: "profesional", name: "Profesional", price: { amount: 14990, currency: "ARS", interval: "month" },
      features: ["content_analysis", "origin_trace", "credibility_meter", "credibility_timeline", "alerts", "api_access"],
      limits: { analysesPerDay: 500, comparisonsPerMonth: 1000, maxSourcesPerComparison: 20, maxIncludeUrls: 20, seats: 1 },
    },
  });

describe("Herramientas del plan", () => {
  test("¿quién lo dijo primero?: pide el tema sólo si la nota es nueva y muestra la cadena", async () => {
    const api = new FakeApi(proMe());
    api.unknownUrls.add("https://nueva.example/nota");
    renderApp(api, "/origen");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Link de la nota"), "https://nueva.example/nota");
    await user.click(screen.getByRole("button", { name: "Buscar el origen" }));
    const topic = await screen.findByLabelText(/¿De qué tema habla\?/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.type(topic, "tarifas de gas");
    await user.click(screen.getByRole("button", { name: "Buscar el origen" }));
    const result = await screen.findByRole("region", { name: "Resultado" });
    expect(result).toHaveTextContent(/Lo publicó primero/);
    expect(result).toHaveTextContent(/1 fuente independiente/);
    expect(within(result).getByText("casi copia")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === "traceOrigin").at(-1)?.args).toEqual(["https://nueva.example/nota", "tarifas de gas"]);
  });

  test("sin el plan, las herramientas explican qué plan las trae", async () => {
    renderApp(new FakeApi(sampleMe()), "/origen");
    expect(await screen.findByText(/viene con el plan Personal/)).toBeInTheDocument();
  });

  test("alertas: crear y apagar", async () => {
    const api = new FakeApi(proMe());
    renderApp(api, "/alertas");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Crear alerta" }));
    expect(screen.getByText("Escribí un tema.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Tema"), "tarifas de gas");
    await user.click(screen.getByRole("radio", { name: /Datos en disputa/ }));
    await user.click(screen.getByRole("button", { name: "Crear alerta" }));
    expect(await screen.findByText(/te vamos a avisar sobre «tarifas de gas»/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "createAlert")?.args[0]).toEqual({ topic: "tarifas de gas", trigger: "new_disagreement", channel: "email" });
    await user.click(screen.getByRole("button", { name: "Apagar la alerta de tarifas de gas" }));
    expect(await screen.findByText("Todavía no tenés alertas.")).toBeInTheDocument();
  });

  test("claves de API: la clave completa se ve una vez; revocar pide confirmar", async () => {
    const api = new FakeApi(proMe());
    renderApp(api, "/cuenta");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombre"), "bot de la redacción");
    await user.click(screen.getByRole("button", { name: "Crear clave" }));
    expect(await screen.findByText("sh_live_abcdSECRETO")).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "createApiKey")?.args).toEqual(["bot de la redacción", ["content:analyze", "smoke:analyze"]]);
    await user.click(screen.getByRole("button", { name: "Ya la guardé" }));
    expect(screen.queryByText("sh_live_abcdSECRETO")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revocar la clave bot de la redacción" }));
    await user.click(screen.getByRole("button", { name: "Sí, revocar" }));
    expect(await screen.findByText("No tenés claves activas.")).toBeInTheDocument();
  });

  test("evolución de la credibilidad: tendencia en palabras y tabla con los mismos datos", async () => {
    const api = new FakeApi(proMe());
    renderApp(api, "/credibilidad");
    const user = userEvent.setup();
    await screen.findByRole("option", { name: "Diario del Valle" });
    await user.selectOptions(screen.getByLabelText("Medio"), "ddv");
    await user.type(screen.getByLabelText("Tema"), "tarifas de gas");
    await user.click(screen.getByRole("button", { name: "Ver credibilidad" }));
    await user.click(await screen.findByRole("button", { name: "Ver la evolución" }));
    expect(await screen.findByText("Bajó de 70 a 50 sobre 100.")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /Credibilidad por período/ });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getAllByText("—", { selector: "td" }).length).toBeGreaterThan(0); // período sin datos: no se inventa un valor
    expect(screen.getByRole("img", { name: /Gráfico de la credibilidad/ })).toBeInTheDocument();
  });

  test("¿esto es humo?: responder y ver la explicación", async () => {
    const api = new FakeApi(sampleMe());
    renderApp(api, "/jugar");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Empezar" }));
    expect(await screen.findByText(/cortan el agua en todo el país/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Es humo" }));
    expect(await screen.findByText("¡Bien!")).toBeInTheDocument();
    expect(screen.getByText(/Alarmismo y pedido de reenvío/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Otra" })).toBeInTheDocument();
  });
});

describe("Salas del equipo", () => {
  const teamMe = () => sampleMe({ organizationId: "org1", plan: { ...sampleMe().plan, id: "equipo", name: "Equipo", features: ["content_analysis", "team_rooms"] } });

  test("sin plan de equipo, explica cómo conseguirlas", async () => {
    renderApp(new FakeApi(sampleMe()), "/salas");
    expect(await screen.findByText(/son para equipos de una organización/)).toBeInTheDocument();
  });

  test("crear una sala, ver quién está y los mensajes en vivo con el nombre de cada uno", async () => {
    const api = new FakeApi(teamMe());
    const { router } = renderApp(api, "/salas");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombre"), "Debate de esta noche");
    await user.click(screen.getByRole("button", { name: "Crear sala" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Debate de esta noche" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/salas/room1");

    await waitFor(() => expect(api.emitRoom).toBeDefined()); // (ya se suscribió a la sala)
    act(() => api.emitRoom!({ type: "presence", userIds: ["u1", "u2"] }));
    expect(screen.getByText("En la sala: Vos, Juan.")).toBeInTheDocument();
    act(() => api.emitRoom!({ type: "message", message: { id: "m1", authorId: "u2", text: "Dicen que subió 45%", links: [], flags: ["sin_fuente"], at: "2026-09-28T21:00:00Z", deleted: false } }));
    const chat = screen.getByRole("region", { name: "Conversación" });
    expect(within(chat).getByText("Juan")).toBeInTheDocument();
    expect(within(chat).getByText("Cifra sin fuente")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Borrar el mensaje de Juan" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Publicar como chequeo/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Tu mensaje"), "Es 30%: https://boletin.example/45");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "postToRoom")?.args).toEqual(["room1", "Es 30%: https://boletin.example/45", undefined]));
  });

  test("quien modera publica chequeos, borra mensajes ajenos y archiva", async () => {
    const api = new FakeApi(teamMe());
    api.canModerateRooms = true;
    api.teamRooms = [{ id: "room1", name: "Mesa", createdBy: "u2", createdAt: "2026-09-28T12:00:00Z", slowModeSeconds: 10 }];
    renderApp(api, "/salas/room1");
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "Mesa" });
    await waitFor(() => expect(api.emitRoom).toBeDefined());
    act(() => api.emitRoom!({ type: "message", message: { id: "m1", authorId: "u2", text: "hola", links: [], flags: [], at: "2026-09-28T21:00:00Z", deleted: false } }));
    await user.click(screen.getByRole("button", { name: "Borrar el mensaje de Juan" }));
    expect(api.calls.find((c) => c.method === "deleteRoomMessage")?.args).toEqual(["m1"]);

    await user.type(screen.getByLabelText("Tu mensaje"), "Chequeado: es 30%");
    await user.click(screen.getByLabelText(/Publicar como chequeo/));
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "postToRoom")?.args[2]).toBe("verificacion"));

    await user.click(screen.getByRole("button", { name: "Archivar" }));
    await user.click(screen.getByRole("button", { name: "Sí, archivar" }));
    expect(await screen.findByText("La sala se archivó")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tu mensaje")).not.toBeInTheDocument();
  });
});

describe("Organización", () => {
  test("sin organización: crearla", async () => {
    const api = new FakeApi(sampleMe());
    renderApp(api, "/organizacion");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombre de la organización"), "Diario Norte");
    await user.click(screen.getByRole("button", { name: "Crear organización" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Diario Norte" })).toBeInTheDocument();
  });

  test("administrar: invitar con rol, cambiar el rol y sacar a alguien con confirmación", async () => {
    const api = new FakeApi(sampleMe({ organizationId: "org1" }));
    api.org = sampleOrg();
    renderApp(api, "/organizacion");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Mail"), "eva@correo.example");
    await user.selectOptions(screen.getByLabelText("Rol"), "moderator");
    await user.click(screen.getByRole("button", { name: "Mandar invitación" }));
    expect(await screen.findByText("Listo: le mandamos la invitación a eva@correo.example.")).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "inviteMember")?.args).toEqual(["eva@correo.example", "moderator"]);

    await user.selectOptions(screen.getByLabelText("Rol de Juan"), "moderator");
    expect(api.calls.find((c) => c.method === "setMemberRole")?.args).toEqual(["u2", "moderator"]);
    expect(screen.queryByLabelText("Rol de Ana")).not.toBeInTheDocument(); // el propio rol no se cambia desde acá
    await user.click(screen.getByRole("button", { name: "Sacar a Juan del equipo" }));
    await user.click(screen.getByRole("button", { name: "Sí, sacar" }));
    await waitFor(() => expect(screen.queryByText("Juan")).not.toBeInTheDocument());
  });

  test("sin lugares, no se ofrece invitar y se explica por qué", async () => {
    const api = new FakeApi(sampleMe({ organizationId: "org1" }));
    api.org = sampleOrg({ seats: { used: 10, limit: 10 } });
    renderApp(api, "/organizacion");
    expect(await screen.findByText("No quedan lugares")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mail")).not.toBeInTheDocument();
  });

  test("unirme sin sesión: se ve de qué equipo es y se entra con el mail invitado (vuelve acá)", async () => {
    renderApp(new FakeApi(), "/unirme?token=bueno");
    expect(await screen.findByRole("heading", { level: 1, name: "Sumarte a Diario Norte" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Entrar con ana@correo.example" })).toHaveAttribute("href", "/entrar?next=%2Funirme%3Ftoken%3Dbueno");
  });

  test("unirme con sesión: aceptar lleva a la organización", async () => {
    const api = new FakeApi(sampleMe());
    const { router } = renderApp(api, "/unirme?token=bueno");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Aceptar y sumarme" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/organizacion"));
  });

  test("un enlace vencido se explica", async () => {
    renderApp(new FakeApi(sampleMe()), "/unirme?token=viejo");
    expect(await screen.findByText(/venció o ya se usó/)).toBeInTheDocument();
  });
});

describe("Webhooks y calificaciones", () => {
  test("webhooks: crear (el secreto se ve una vez), probar y ver que falló", async () => {
    const api = new FakeApi(sampleMe({ plan: { ...sampleMe().plan, features: ["webhooks"] } }));
    renderApp(api, "/cuenta");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Dirección (https)"), "https://redaccion.example/hook");
    await user.click(screen.getByRole("checkbox", { name: "Saltó una alerta" }));
    await user.click(screen.getByRole("button", { name: "Crear webhook" }));
    expect(await screen.findByText("whsec_SECRETO")).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "createWebhook")?.args).toEqual(["https://redaccion.example/hook", ["analysis.completed", "alert.triggered"]]);
    await user.click(screen.getByRole("button", { name: "Ya lo guardé" }));
    expect(screen.queryByText("whsec_SECRETO")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mandar una prueba" }));
    expect(await screen.findByText(/Último envío: falló \(Respondió HTTP 500.\)/)).toBeInTheDocument();
  });

  test("webhooks: una dirección que no es https se avisa en el campo", async () => {
    const api = new FakeApi(sampleMe({ plan: { ...sampleMe().plan, features: ["webhooks"] } }));
    renderApp(api, "/cuenta");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Dirección (https)"), "http://inseguro.example");
    await user.click(screen.getByRole("button", { name: "Crear webhook" }));
    expect(screen.getByText("Tiene que ser una dirección https.")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "createWebhook")).toBe(false);
  });

  test("calificar Sin Humo desde Ayuda: estrellas con teclado y comentario en revisión", async () => {
    const api = new FakeApi(sampleMe());
    renderApp(api, "/ayuda");
    const user = userEvent.setup();
    expect(await screen.findByText(/Promedio: 4,3 de 5 \(12 calificaciones\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /4 de 5: Bien/ }));
    await user.type(screen.getByLabelText("Comentario (opcional)"), "Muy útil para las cadenas");
    await user.click(screen.getByRole("button", { name: "Enviar calificación" }));
    expect(await screen.findByText(/queda en revisión/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "review")?.args).toEqual([4, "Muy útil para las cadenas"]);
  });
});

describe("Backoffice", () => {
  const staff = (...permissions: string[]) => new FakeApi(sampleMe({ permissions }));

  test("cada persona ve sólo las secciones de sus permisos; sin ninguna, no aparece", async () => {
    renderApp(staff("support:handle", "abuse:manage"), "/admin");
    const nav = await screen.findByRole("navigation", { name: "Backoffice" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["Soporte", "Abuso y restricciones"]);
    expect(await screen.findByRole("heading", { level: 1, name: "Soporte" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Backoffice" })).toBeInTheDocument();
  });

  test("sin permisos no hay backoffice", async () => {
    renderApp(new FakeApi(sampleMe()), "/admin");
    expect(await screen.findByText("Tu cuenta no tiene tareas de administración.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Backoffice" })).not.toBeInTheDocument();
  });

  test("soporte: la consulta vencida se ve, se responde con nota interna y cambio de estado", async () => {
    const bo = new FakeBackoffice();
    renderApp(staff("support:handle"), "/admin/soporte", bo);
    const user = userEvent.setup();
    expect(await screen.findByText("Vencida")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /T-1 · No me llega el enlace/ }));
    await user.click(screen.getByRole("checkbox", { name: "Es una nota interna" }));
    await user.type(screen.getByLabelText("Nota interna (no la ve la persona)"), "Revisar el filtro de spam del dominio.");
    await user.selectOptions(screen.getByLabelText("Cambiar el estado"), "pending");
    await user.click(screen.getByRole("button", { name: "Guardar nota" }));
    expect(await screen.findByText("Nota guardada.")).toBeInTheDocument();
    expect(bo.calls.find((c) => c.method === "replyAsAgent")?.args).toEqual(["T-1", "Revisar el filtro de spam del dominio.", { internal: true, status: "pending" }]);
  });

  test("verificación: tomar, traer evidencia oficial y resolver con nota", async () => {
    const bo = new FakeBackoffice();
    renderApp(staff("verdicts:write"), "/admin/verificacion", bo);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "¿El aumento es de 30% o de 18%?" }));
    await user.click(screen.getByRole("button", { name: "Tomar la tarea" }));
    await user.click(await screen.findByRole("button", { name: "Buscar en fuentes oficiales" }));
    expect(await screen.findByText(/Resolución 45/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Falso" }));
    await user.type(screen.getByLabelText(/Nota \(se publica/), "La resolución 45 fija un aumento de 30%, no de 18%.");
    await user.click(screen.getByRole("button", { name: "Resolver" }));
    await waitFor(() => expect(bo.calls.find((c) => c.method === "resolveTask")?.args[1]).toEqual({ c1: "refuted", c2: "refuted" }));
  });

  test("réplicas: se resuelven con fundamento", async () => {
    const bo = new FakeBackoffice();
    renderApp(staff("rebuttal:resolve"), "/admin/replicas", bo);
    const user = userEvent.setup();
    expect(await screen.findByText(/pedimos revisar la dimensión de precisión/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Rechazar" }));
    const resolve = screen.getByRole("button", { name: "Resolver" });
    expect(resolve).toBeDisabled();
    await user.type(screen.getByLabelText(/Fundamento/), "La nota omitía que la resolución fue posterior.");
    await user.click(resolve);
    expect(await screen.findByText("Réplica rechazada.")).toBeInTheDocument();
    expect(bo.calls.find((c) => c.method === "resolveRebuttal")?.args.slice(0, 2)).toEqual(["r1", "rejected"]);
  });

  test("abuso: levantar una restricción automática", async () => {
    const bo = new FakeBackoffice();
    renderApp(staff("abuse:manage"), "/admin/abuso", bo);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Levantar la restricción a 203.0.113.9" }));
    await waitFor(() => expect(bo.calls.some((c) => c.method === "liftRestriction")).toBe(true));
  });

  test("métricas: en palabras y tablas", async () => {
    renderApp(staff("stats:business"), "/admin/metricas");
    expect(await screen.findByText("Ingreso mensual recurrente")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Por plan" })).toBeInTheDocument();
  });

  test("parámetros: cambiar pide el motivo", async () => {
    const bo = new FakeBackoffice();
    renderApp(staff("rules:business"), "/admin/parametros", bo);
    const user = userEvent.setup();
    const input = await screen.findByLabelText(/Valor \(de 0 a 600 s\)/);
    await user.clear(input);
    await user.type(input, "30");
    await user.type(screen.getByLabelText("Motivo del cambio"), "Mucho spam en el debate");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(bo.calls.find((c) => c.method === "setParameter")?.args).toEqual(["events.slow_mode_seconds", 30, "Mucho spam en el debate"]));
  });

  test("reglas: borrador → prueba → aprobación", async () => {
    const bo = new FakeBackoffice();
    renderApp(staff("rules:business"), "/admin/reglas", bo);
    const user = userEvent.setup();
    await user.click(await screen.findByText("Nueva regla", { selector: "summary" }));
    await user.type(screen.getByLabelText("Nombre"), "Sin API los domingos");
    await user.type(screen.getByLabelText("Condición 1: valor"), "gratis");
    await user.type(screen.getByLabelText("Mensaje para la persona"), "Probá mañana");
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Sin API los domingos" })).toBeInTheDocument();
    expect(bo.calls.find((c) => c.method === "saveRule")?.args[0]).toMatchObject({ conditions: [{ field: "plan", op: "eq", value: "gratis" }], effect: { type: "deny", message: "Probá mañana" } });
    expect(screen.getByRole("button", { name: "Aprobar y activar" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Probar" }));
    expect(await screen.findByText("Pasaron todos los escenarios")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aprobar y activar" }));
    await waitFor(() => expect(bo.calls.some((c) => c.method === "approveRule")).toBe(true));
  });

  test("funciones en prueba: apagar de emergencia", async () => {
    const bo = new FakeBackoffice();
    renderApp(staff("flags:manage"), "/admin/funciones", bo);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Prendida" }));
    expect(await screen.findByRole("checkbox", { name: "Apagada" })).not.toBeChecked();
    expect(bo.calls.find((c) => c.method === "updateFlag")?.args).toEqual(["event_rooms", { enabled: false }]);
  });

  test("eventos: crear y moderar en vivo (chequeo y silenciar)", async () => {
    const bo = new FakeBackoffice();
    const api = staff("events:host");
    renderApp(api, "/admin/eventos", bo);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Título/), "Debate presidencial");
    await user.click(screen.getByRole("button", { name: "Crear evento" }));
    expect(await screen.findByRole("link", { name: "/eventos/ABC234" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Moderar" }));
    await user.type(screen.getByLabelText("Publicar un chequeo"), "FALSO: la inflación fue 3,7%.");
    await user.click(screen.getByRole("button", { name: "Publicar chequeo" }));
    await waitFor(() => expect(bo.calls.find((c) => c.method === "factCheck")?.args).toEqual(["ev1", "FALSO: la inflación fue 3,7%."]));
    await waitFor(() => expect(api.emit).toBeDefined());
    act(() => api.emit!({ type: "message", message: { id: "m9", alias: "Participante 4F2A", text: "insulto", links: [], flags: [], at: "2026-09-28T21:00:00Z", deleted: false } }));
    await user.click(screen.getByRole("button", { name: "Silenciar y borrar el mensaje de Participante 4F2A" }));
    expect(await screen.findByText(/Participante 4F2A no puede escribir hasta/)).toBeInTheDocument();
  });
});

describe("Fotos y videos", () => {
  test("revisar: sube el archivo y muestra las señales y lo que dice el archivo", async () => {
    const api = new FakeApi(sampleMe());
    renderApp(api, "/revisar");
    const user = userEvent.setup();
    await user.upload(await screen.findByLabelText("Foto o video"), new File(["x"], "foto.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("button", { name: "Revisar" }));
    expect(await screen.findByText("Ojo: ya circuló antes.")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Lo que dice el archivo" })).toHaveTextContent("Adobe Photoshop 25.0");
    expect(api.calls.find((c) => c.method === "checkMedia")?.args).toEqual(["foto.jpg", "image/jpeg"]);
  });

  test("un archivo que no es foto ni video se avisa antes de subir", async () => {
    const api = new FakeApi(sampleMe());
    renderApp(api, "/revisar");
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(await screen.findByLabelText("Foto o video"), new File(["x"], "doc.pdf", { type: "application/pdf" }));
    expect(screen.getByText("Elegí una foto o un video.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revisar" })).toBeDisabled();
  });
});

describe("Páginas públicas (sin cuenta)", () => {
  test("observatorio: lo que circula y el mes, con metodología", async () => {
    renderApp(new FakeApi(), "/observatorio");
    expect(await screen.findByText("«Mañana cortan el agua en todo el país»")).toBeInTheDocument();
    expect(await screen.findByText("42 %")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Tipos de humo" })).toHaveTextContent("Alarmismo");
    expect(screen.getByText(/se ocultaron 2 grupos/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Observatorio" }).length).toBeGreaterThan(0); // menú y pie
  });

  test("ficha de un medio: dueños, pauta con su monto y réplicas; sin sesión, la credibilidad pide entrar", async () => {
    renderApp(new FakeApi(), "/medios/ddv");
    expect(await screen.findByRole("heading", { level: 1, name: "Diario del Valle" })).toBeInTheDocument();
    expect(screen.getByText("Grupo Andino")).toBeInTheDocument();
    expect(screen.getByText(/también tiene negocios en energía/)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Pauta oficial por quién paga" })).toHaveTextContent(/96\.000\.000/);
    expect(screen.getByText(/Réplica · Aceptada/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mirá su credibilidad por tema" })).toHaveAttribute("href", "/entrar?next=%2Fcredibilidad");
  });

  test("fe de erratas", async () => {
    renderApp(new FakeApi(), "/fe-de-erratas");
    expect(await screen.findByText("Corregimos el veredicto sobre la baja del gas.")).toBeInTheDocument();
  });

  test("datos abiertos: se bajan con su licencia", async () => {
    renderApp(new FakeApi(), "/datos");
    expect(await screen.findByRole("link", { name: "Bajar CSV de Humo por mes" })).toHaveAttribute("href", "/public/datasets/humo-mensual.csv");
  });
});

describe("Mis fuentes, reglas y réplica", () => {
  const withSources = () => sampleMe({ plan: { ...sampleMe().plan, features: ["source_connections"] } });

  test("conectar un feed; si falla la prueba se explica; desconectar", async () => {
    const api = new FakeApi(withSources());
    renderApp(api, "/fuentes");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Dirección del feed"), "https://roto.example/rss");
    await user.click(screen.getByRole("button", { name: "Conectar" }));
    expect(await screen.findByText("No se pudo conectar")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Dirección del feed"));
    await user.type(screen.getByLabelText("Dirección del feed"), "https://diario.example/rss");
    await user.click(screen.getByRole("button", { name: "Conectar" }));
    await user.click(await screen.findByRole("button", { name: "Desconectar https://diario.example/rss" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "disconnectSource")).toBe(true));
  });

  test("buzón: pide contraseña de aplicación y la manda aparte de la configuración", async () => {
    const api = new FakeApi(withSources());
    renderApp(api, "/fuentes");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Mi buzón de mail" }));
    expect(screen.getByText(/contraseña de aplicación/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Servidor IMAP/), "imap.gmail.com");
    await user.type(screen.getByLabelText("Usuario (tu mail)"), "ana@gmail.com");
    await user.type(screen.getByLabelText("Contraseña de aplicación"), "abcd efgh");
    await user.click(screen.getByRole("button", { name: "Conectar" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "connectSource")?.args[0]).toEqual({ type: "email", name: "ana@gmail.com", config: { host: "imap.gmail.com", user: "ana@gmail.com", port: "993", folder: "INBOX" }, secret: "abcd efgh" }));
  });

  test("reglas: excluir medios, uno por línea", async () => {
    const api = new FakeApi(sampleMe());
    renderApp(api, "/reglas");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombre"), "Sin opinión");
    await user.type(screen.getByLabelText("No usar nunca"), "opinionesya.example{enter}diario.example/opinion");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Nunca: opinionesya.example, diario.example/opinion")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Quitar la regla Sin opinión" }));
    expect(await screen.findByText("No tenés reglas guardadas.")).toBeInTheDocument();
  });

  test("réplica: sólo representantes; pide 50 caracteres y queda en revisión", async () => {
    renderApp(new FakeApi(sampleMe()), "/replica");
    expect(await screen.findByText(/tenés que estar acreditado/)).toBeInTheDocument();
  });

  test("réplica de un representante", async () => {
    const api = new FakeApi(sampleMe({ representsOutletIds: ["ddv"] }));
    renderApp(api, "/replica");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Tema de la evaluación"), "tarifas de gas");
    await user.type(screen.getByLabelText("Qué está mal y por qué"), "Muy corto");
    expect(screen.getByRole("button", { name: "Presentar réplica" })).toBeDisabled();
    await user.type(screen.getByLabelText("Qué está mal y por qué"), " — la nota citaba la resolución oficial completa y la evaluación no lo tuvo en cuenta.");
    await user.click(screen.getByRole("button", { name: "Presentar réplica" }));
    expect(await screen.findByText("En revisión")).toBeInTheDocument();
  });
});

describe("Estadísticas", () => {
  const pro = (permissions: string[] = []) => sampleMe({ permissions, plan: { ...sampleMe().plan, features: ["export", "scheduled_reports"] } });

  test("resumen, gráfico con su tabla, exportar y programar un reporte", async () => {
    const api = new FakeApi(pro());
    renderApp(api, "/estadisticas");
    const user = userEvent.setup();
    expect(await screen.findByText("38 %")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /40 en total, 38 % con humo/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Mensajes por día" })).toHaveTextContent("25");
    expect(screen.getByRole("link", { name: /Excel \(estadísticas\)/ })).toHaveAttribute("href", expect.stringContaining("kind=usage_panel&format=xlsx&scope=user"));
    expect(screen.queryByLabelText("De quién")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Programar" }));
    expect(await screen.findByText(/el primero sale el/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "createReportSchedule")?.args[0]).toMatchObject({ kind: "usage_panel", frequency: "weekly", recipients: ["ana@correo.example"] });
  });

  test("con permiso de organización se elige de quién; sin plan, se explica", async () => {
    renderApp(new FakeApi(pro(["stats:org"])), "/estadisticas");
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("De quién"), "organization");
    expect(await screen.findByText("Personas que lo usaron")).toBeInTheDocument();
  });

  test("un período largo se agrupa por mes (columnas legibles) y la tabla también", async () => {
    const api = new FakeApi(pro());
    const days = Array.from({ length: 200 }, (_, i) => ({ day: new Date(Date.UTC(2026, 2, 1) + i * 86_400_000).toISOString().slice(0, 10), analyses: 2, withSmoke: 1, comparisons: 0 }));
    const base = await api.usagePanel("user");
    api.usagePanel = async () => ({ ...base, daily: days, totals: { ...base.totals, analyses: 400, withSmoke: 200 } });
    renderApp(api, "/estadisticas");
    expect(await screen.findByRole("heading", { name: "Mensajes por mes" })).toBeInTheDocument();
    const rows = within(screen.getByRole("table", { name: "Mensajes por mes" })).getAllByRole("row");
    expect(rows.length).toBe(1 + 7); // encabezado + marzo a septiembre
  });

  test("sin exportar en el plan, se explica", async () => {
    renderApp(new FakeApi(sampleMe()), "/estadisticas");
    expect(await screen.findByText(/Exportar a Excel, CSV o PDF viene con el plan Profesional/)).toBeInTheDocument();
  });
});

describe("Aulas, respuestas públicas y campañas", () => {
  test("aulas: sólo docentes; crear, ver el progreso por apodo y archivar", async () => {
    renderApp(new FakeApi(sampleMe()), "/aulas");
    expect(await screen.findByText(/docentes de escuelas registradas/)).toBeInTheDocument();
  });

  test("aulas de un docente", async () => {
    const api = new FakeApi(sampleMe({ permissions: ["learning:teach"], plan: { ...sampleMe().plan, features: ["learning_mode"] } }));
    renderApp(api, "/aulas");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombre"), "3° B");
    await user.click(screen.getByRole("button", { name: "Crear aula" }));
    expect(await screen.findByText("A1B2C3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ver progreso" }));
    const table = await screen.findByRole("table", { name: "Progreso por estudiante" });
    expect(table).toHaveTextContent("Lu");
    expect(table).toHaveTextContent("3 (75 %)");
    expect(screen.getByText(/Lo que más les cuesta/).closest("p")).toHaveTextContent("Alarmismo (2 errores)");
    await user.click(screen.getByRole("button", { name: "Archivar (fin del año)" }));
    await user.click(screen.getByRole("button", { name: "Sí, archivar" }));
    expect(await screen.findByText("Todavía no creaste aulas.")).toBeInTheDocument();
  });

  test("respuestas: quien modera aprueba y se publica", async () => {
    const api = new FakeApi(sampleMe({ permissions: ["replies:moderate", "replies:publish_public"] }));
    renderApp(api, "/respuestas");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Aprobar y publicar: El gas no sube 300%" }));
    expect(await screen.findByText("No hay respuestas esperando.")).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "reviewReply")?.args).toEqual(["rp1", true]);
  });

  test("campañas: crear (a revisión), aprobar otra persona, lanzar y ver resultados", async () => {
    const api = new FakeApi(sampleMe({ permissions: ["campaigns:manage", "campaigns:review"] }));
    renderApp(api, "/campanas");
    const user = userEvent.setup();
    await user.click(await screen.findByText("Nueva campaña", { selector: "summary" }));
    await user.type(screen.getByLabelText(/Qué afirmación contrarresta/), "El gas sube 300% mañana en todo el país");
    await user.type(screen.getByLabelText("Título del mensaje"), "El gas no sube 300%");
    await user.type(screen.getByLabelText("Qué dicen los datos"), "La resolución 45 fija un aumento de 30%.");
    await user.type(screen.getByLabelText(/Fuentes/), "https://boletin.example/45");
    await user.click(screen.getByRole("button", { name: "Mandar a revisión" }));
    expect(await screen.findByText("La tiene que aprobar otra persona del equipo.")).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "createCampaign")?.args[0]).toMatchObject({ links: [{ label: "boletin.example", url: "https://boletin.example/45" }], channelIds: ["seguidores_del_tema"] });

    api.campaignList = api.campaignList.map((c) => ({ ...c, ownerId: "otra" }));
    renderApp(api, "/campanas");
    const [second] = screen.getAllByRole("main").slice(-1);
    await user.type(await within(second!).findByLabelText(/Nota de revisión/), "Fuentes correctas, tono adecuado.");
    await user.click(within(second!).getByRole("button", { name: "Aprobar" }));
    await user.click(await within(second!).findByRole("button", { name: "Lanzar" }));
    await user.click(await within(second!).findByRole("button", { name: "Ver resultados" }));
    expect(await within(second!).findByText("-45 %")).toBeInTheDocument();
  });
});

describe("Referidos, marca propia y cupones", () => {
  test("referidos: mi código y usar el de quien me invitó", async () => {
    const api = new FakeApi(sampleMe());
    renderApp(api, "/cuenta");
    const user = userEvent.setup();
    expect(await screen.findByText("ANA-7K2P")).toBeInTheDocument();
    expect(screen.getByText(/Invitaste a 3; 1 ya te dieron premio y 2 todavía no se suscribió/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Te invitó alguien/), "juan-1234");
    await user.click(screen.getByRole("button", { name: "Usar código" }));
    expect(await screen.findByText("BIENVENIDA-X1")).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === "applyReferral")?.args).toEqual(["JUAN-1234"]);
  });

  test("marca propia: el color sin contraste no se guarda; el dominio se verifica con un TXT", async () => {
    const api = new FakeApi(sampleMe({ organizationId: "org1", permissions: ["users:manage_org"], plan: { ...sampleMe().plan, features: ["white_label"] } }));
    renderApp(api, "/marca");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombre que se muestra"), "Diario Norte");
    const color = screen.getByLabelText("Color principal");
    await user.clear(color);
    await user.type(color, "#ffff00");
    expect(screen.getByText("Elegí un color más oscuro.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    await user.clear(color);
    await user.type(color, "#0b3d91");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await user.type(await screen.findByLabelText("Dominio"), "chequeo.diarionorte.example");
    await user.click(screen.getByRole("button", { name: "Usar este dominio" }));
    expect(await screen.findByText("_sinhumo.chequeo.diarionorte.example")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Verificar" }));
    expect(await screen.findByText("Verificado")).toBeInTheDocument();
  });

  test("cupones en el backoffice: crear y desactivar", async () => {
    const bo = new FakeBackoffice();
    renderApp(new FakeApi(sampleMe({ permissions: ["plans:manage"] })), "/admin/cupones", bo);
    const user = userEvent.setup();
    await user.click(await screen.findByText("Nuevo cupón", { selector: "summary" }));
    await user.type(screen.getByLabelText(/^Código/), "beca-prensa");
    await user.type(screen.getByLabelText("Descripción"), "Beca para periodistas");
    await user.click(screen.getByRole("button", { name: "Crear cupón" }));
    const table = await screen.findByRole("table", { name: "Cupones" });
    expect(table).toHaveTextContent("BECA-PRENSA");
    await user.click(screen.getByRole("button", { name: "Desactivar el cupón BECA-PRENSA" }));
    expect(await screen.findByText("Inactivo")).toBeInTheDocument();
  });
});

describe("Backoffice: temas, calidad, datos y operación", () => {
  const staff = (...permissions: string[]) => new FakeApi(sampleMe({ permissions }));

  test("temas: editar manda el tema completo; lo desactivado se ve sólo si se pide", async () => {
    const bo = new FakeBackoffice();
    renderApp(staff("taxonomy:manage"), "/admin/temas", bo);
    const user = userEvent.setup();
    expect(await screen.findByText("tarifas de gas", { selector: "strong" })).toBeInTheDocument();
    expect(screen.queryByText("yerba mate", { selector: "strong" })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Mostrar también los desactivados"));
    expect(screen.getByText("yerba mate", { selector: "strong" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Editar tarifas de gas" }));
    const syn = screen.getByLabelText(/^Sinónimos \(tarifas de gas\)/);
    await user.clear(syn);
    await user.type(syn, "gas natural, garrafa");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(bo.calls.find((c) => c.method === "saveTopic")?.args[0]).toEqual({
        id: "gas", name: "tarifas de gas", categoryId: "economia", keywords: ["gas", "tarifa"], synonyms: ["gas natural", "garrafa"], countries: [], sensitive: false, active: true,
      }),
    );

    await user.type(screen.getByLabelText("Nombre"), "Subsidios");
    expect(screen.getByRole("button", { name: "Crear tema" })).toBeDisabled();
    await user.type(screen.getByLabelText(/^Palabras clave/), "subsidio, subsidios");
    await user.click(screen.getByRole("button", { name: "Crear tema" }));
    expect(await screen.findByText("Tema creado.")).toBeInTheDocument();
  });

  test("calidad: revisar un ejemplo, medir y poner en uso una candidata", async () => {
    const bo = new FakeBackoffice();
    renderApp(staff("quality:manage"), "/admin/calidad", bo);
    const user = userEvent.setup();
    const versions = await screen.findByRole("table", { name: "Versiones del algoritmo y sus mediciones" });
    expect(within(versions).getByText("85 % de 20")).toBeInTheDocument();

    await user.click(within(screen.getByRole("group", { name: /^¿Tiene humo\? \(«Increíble oferta/ })).getByRole("checkbox", { name: "Promesa vaga" }));
    await user.click(screen.getByRole("button", { name: "Confirmar etiqueta de ex1" }));
    await waitFor(() => expect(bo.calls.find((c) => c.method === "reviewExample")?.args).toEqual(["ex1", { isSmoke: true, types: ["marketing", "vague_promise"] }]));
    expect(await screen.findByText("No hay ejemplos pendientes.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Medir con los ejemplos revisados" }));
    expect(await screen.findByText("1 ejemplo(s) donde se equivocó")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Por tipo de humo" })).toHaveTextContent("Alarmismo");

    await user.click(screen.getByRole("button", { name: "Poner en uso llm-v1" }));
    await waitFor(() => expect(bo.calls.find((c) => c.method === "promote")?.args).toEqual(["llm-v1"]));
  });

  test("documentos oficiales: sin URL oficial no se carga; con todo, se manda sólo lo del documento", async () => {
    const bo = new FakeBackoffice();
    renderApp(staff("verdicts:write"), "/admin/documentos", bo);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Título"), "Resolución 45/2026");
    await user.type(screen.getByLabelText(/^Quién lo emitió/), "ENARGAS");
    await user.type(screen.getByLabelText(/^URL oficial/), "boletin");
    await user.type(screen.getByLabelText(/^Texto del documento/), "Aumento del 30% en la tarifa de gas.");
    await user.click(screen.getByRole("button", { name: "Cargar documento" }));
    expect(screen.getByText("Poné la URL completa (https://…).")).toBeInTheDocument();
    expect(bo.calls.some((c) => c.method === "uploadDocument")).toBe(false);

    await user.clear(screen.getByLabelText(/^URL oficial/));
    await user.type(screen.getByLabelText(/^URL oficial/), "https://boletin.example/45");
    await user.type(screen.getByLabelText(/^Temas/), "tarifas de gas");
    await user.click(screen.getByRole("button", { name: "Cargar documento" }));
    expect(await screen.findByText("Documento cargado: «Resolución 45/2026».")).toBeInTheDocument();
    const doc = bo.calls.find((c) => c.method === "uploadDocument")!.args[0] as Record<string, unknown>;
    expect(Object.keys(doc).sort()).toEqual(["issuer", "publishedAt", "text", "title", "topics", "url"]);
    expect(doc.topics).toEqual(["tarifas de gas"]);
  });

  test("catálogo: importar una fuente configurada y subir un CSV; el informe muestra lo que no se reconoció", async () => {
    const bo = new FakeBackoffice();
    renderApp(staff("outlets:write"), "/admin/catalogo", bo);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Importar Pauta oficial nacional (datos abiertos)" }));
    expect(await screen.findByText("Se cargaron 1 medios, 1 feeds.")).toBeInTheDocument();
    expect(screen.getByText("No se reconocieron (1)")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Qué contiene"), "ownership");
    const csv = new File(["medio,dueno\nEl Litoral,Grupo Norte"], "propiedad.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText(/^Archivo CSV/), csv);
    await user.click(screen.getByRole("button", { name: "Importar CSV" }));
    await waitFor(() => expect(bo.calls.find((c) => c.method === "importCsv")?.args).toEqual(["ownership", "medio,dueno\nEl Litoral,Grupo Norte"]));
  });

  test("auditoría: de a 200; ver más antiguas pide hasta antes de la última mostrada", async () => {
    const bo = new FakeBackoffice();
    bo.auditEntries = Array.from({ length: 250 }, (_, i) => ({ id: `a${i}`, at: new Date(Date.UTC(2026, 8, 28, 12) - i * 60_000).toISOString(), action: "ops.backup_accessed", actorId: "u1", data: {} }));
    bo.audit = async (filter) => {
      bo.calls.push({ method: "audit", args: [filter] });
      return bo.auditEntries.filter((e) => !filter.to || e.at <= filter.to).slice(0, 200);
    };
    renderApp(staff("audit:read"), "/admin/auditoria", bo);
    const user = userEvent.setup();
    const table = await screen.findByRole("table", { name: "Registros de auditoría" });
    expect(within(table).getAllByRole("row")).toHaveLength(201);
    await user.click(screen.getByRole("button", { name: "Ver más antiguas" }));
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(251));
    const last = bo.calls.filter((c) => c.method === "audit").at(-1)!.args[0] as { to: string };
    expect(last.to).toBe(new Date(Date.parse(bo.auditEntries[199]!.at) - 1).toISOString());
    expect(screen.queryByRole("button", { name: "Ver más antiguas" })).not.toBeInTheDocument();
  });

  test("costos: el cliente que cuesta más de lo que paga se marca", async () => {
    renderApp(staff("plans:manage"), "/admin/costos", new FakeBackoffice());
    const clients = await screen.findByRole("table", { name: "Por cliente (los que más cuestan primero)" });
    expect(within(clients).getAllByRole("row")[1]).toHaveTextContent("Fuera de presupuesto");
    expect(screen.getByRole("table", { name: "Por proveedor" })).toHaveTextContent("anthropic");
  });

  test("copias de seguridad: hacer una y verificarla", async () => {
    const bo = new FakeBackoffice();
    renderApp(staff("ops:backup"), "/admin/copias", bo);
    const user = userEvent.setup();
    await screen.findByRole("table", { name: "Copias guardadas" });
    await user.click(screen.getByRole("button", { name: "Hacer una copia" }));
    expect(await screen.findByText("Copia hecha (2,4 MB). Conviene verificarla.")).toBeInTheDocument();
    expect(screen.getByText("Sin verificar")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /^Verificar la copia del/ })[0]!);
    await waitFor(() => expect(screen.queryByText("Sin verificar")).not.toBeInTheDocument());
    expect(bo.calls.find((c) => c.method === "verifyBackup")?.args).toEqual(["backups/2026/09/28/sinhumo-b2.shbk"]);
  });
});

describe("Backoffice: personas", () => {
  const admin = () => new FakeApi(sampleMe({ permissions: ["users:manage_all"] }));

  test("sin buscar se ve el equipo; buscar por teléfono y darle un rol", async () => {
    const bo = new FakeBackoffice();
    renderApp(admin(), "/admin/personas", bo);
    const user = userEvent.setup();
    const table = await screen.findByRole("table", { name: "Cuentas encontradas" });
    expect(table).toHaveTextContent("Ana Admin");
    expect(table).not.toHaveTextContent("Juan Pérez");

    await user.type(screen.getByLabelText("Mail, teléfono o id de la cuenta"), "+5491155554444");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await user.click(await screen.findByRole("button", { name: "Gestionar a Juan Pérez" }));
    expect(screen.getByText("Organización: Redacción QA", { exact: false })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Rol para agregar"), "fact_checker");
    await user.click(screen.getByRole("button", { name: "Dar el rol" }));
    expect(await screen.findByRole("button", { name: "Quitar el rol Verificador a Juan Pérez" })).toBeInTheDocument();
    expect(bo.calls.find((c) => c.method === "addUserRole")?.args).toEqual(["u-juan", "fact_checker"]);
  });

  test("suspender pide motivo; una suspendida muestra por qué y se puede reactivar", async () => {
    const bo = new FakeBackoffice();
    renderApp(admin(), "/admin/personas", bo);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Mail, teléfono o id de la cuenta"), "u-juan");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await user.click(await screen.findByRole("button", { name: "Gestionar a Juan Pérez" }));
    await user.click(screen.getByRole("button", { name: "Suspender la cuenta" }));
    expect(screen.getByText("Explicá el motivo (al menos 10 caracteres).")).toBeInTheDocument();
    expect(bo.calls.some((c) => c.method === "suspendUser")).toBe(false);
    await user.type(screen.getByLabelText(/^Motivo de la suspensión/), "Spam en eventos en vivo");
    await user.click(screen.getByRole("button", { name: "Suspender la cuenta" }));
    expect(await screen.findByText(/«Spam en eventos en vivo»/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ver las suspendidas" }));
    const table = await screen.findByRole("table", { name: "Cuentas encontradas" });
    await waitFor(() => expect(table).toHaveTextContent("Cuenta spam"));
    await user.click(screen.getByRole("button", { name: "Gestionar a Cuenta spam" }));
    await user.type(screen.getByLabelText(/^Motivo para reactivarla/), "Aclaró que fue un error");
    await user.click(screen.getByRole("button", { name: "Reactivar la cuenta" }));
    await waitFor(() => expect(bo.calls.find((c) => c.method === "reactivateUser")?.args).toEqual(["u-susp", "Aclaró que fue un error"]));
  });

  test("acreditar y quitar un medio representado", async () => {
    const bo = new FakeBackoffice();
    renderApp(admin(), "/admin/personas", bo);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Mail, teléfono o id de la cuenta"), "juan@correo.example");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await user.click(await screen.findByRole("button", { name: "Gestionar a Juan Pérez" }));
    await user.click(await screen.findByRole("button", { name: "Acreditar como representante" }));
    const quitar = await screen.findByRole("button", { name: /^Dejar de acreditar a Juan Pérez por/ });
    await user.click(quitar);
    expect(await screen.findByText("Ninguno.")).toBeInTheDocument();
  });
});

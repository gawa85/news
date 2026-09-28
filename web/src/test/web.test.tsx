import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ApiError } from "../api/ApiError";
import { HttpSinHumoApi } from "../api/HttpSinHumoApi";
import { FakeApi, sampleMe, sampleOrg } from "./FakeApi";
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

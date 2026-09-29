/**
 * ACCESIBILIDAD AUTOMÁTICA: cada pantalla de la web (pública, de la persona y del backoffice)
 * pasa axe con las reglas de WCAG 2.2 AA, con una cuenta que ve todo.
 * jsdom no dibuja: el contraste de colores y el tamaño de los blancos se revisan en un navegador
 * real (Playwright + axe) antes de publicar.
 */
import { screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import type { RouteObject } from "react-router";
import { describe, expect, test } from "vitest";
import { routes } from "../app/App";
import { FakeApi, sampleMe } from "./FakeApi";
import { renderApp } from "./render";

const EVERY_PERMISSION = [
  "support:handle", "verdicts:write", "rebuttal:resolve", "corrections:publish", "events:host", "abuse:manage", "stats:business", "rules:business",
  "plans:manage", "legal:publish", "flags:manage", "taxonomy:manage", "quality:manage", "outlets:write", "audit:read", "ops:backup", "users:manage_all",
  "users:manage_org", "learning:teach", "replies:publish_public", "replies:moderate", "campaigns:manage", "campaigns:review", "rebuttal:write", "stats:org",
];
const EVERY_FEATURE = [
  "smoke_analysis", "source_comparison", "origin_trace", "credibility_meter", "credibility_timeline", "url_rules", "alerts", "ai_engine", "export", "api_access",
  "org_rules", "content_analysis", "source_connections", "public_replies", "webhooks", "campaigns", "team_rooms", "scheduled_reports", "bi_feed", "white_label",
  "learning_mode", "audio_replies", "voice_notes", "screenshots", "evidence_archive", "daily_digest",
];
/** Rutas con parámetros: un valor que existe en la API falsa (las demás no se prueban acá). */
const PARAMS: Record<string, string[]> = { "/medios/:id": ["/medios/ddv"], "/legal/:slug": ["/legal/terminos", "/legal/privacidad"] };

function paths(list: RouteObject[], prefix = ""): string[] {
  return list.flatMap((r) => {
    if (r.path === "*") return [];
    const here = r.path === undefined ? prefix : r.path.startsWith("/") ? r.path : `${prefix.replace(/\/$/, "")}/${r.path}`;
    const own = r.path === undefined ? [] : here.includes(":") ? (PARAMS[here] ?? []) : [here];
    return [...own, ...paths(r.children ?? [], here)];
  });
}
const ALL = [...new Set(paths(routes))];

const everything = () =>
  new FakeApi(
    sampleMe({
      permissions: EVERY_PERMISSION,
      organizationId: "org1",
      representsOutletIds: ["ddv"],
      plan: { id: "empresa", name: "Empresa", features: EVERY_FEATURE, limits: { analysesPerDay: null, comparisonsPerMonth: null, maxSourcesPerComparison: 10, maxIncludeUrls: 20, seats: 50 }, price: { amount: 399990, currency: "ARS", interval: "month" } },
    }),
  );

describe("Accesibilidad (WCAG 2.2 AA) en todas las pantallas", () => {
  test("se prueban todas las rutas (si se agrega una, entra sola)", () => {
    expect(ALL.length).toBeGreaterThan(50);
    expect(ALL).toContain("/admin/personas");
  });

  test.each(ALL)("%s", async (path) => {
    renderApp(everything(), path);
    await waitFor(() => expect(screen.queryAllByText("Cargando…")).toHaveLength(0), { timeout: 3000 });
    await screen.findAllByRole("heading", { level: 1 });
    const result = await axe.run(document.body, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
      rules: {
        // (sin dibujo no se pueden medir: se revisan en el navegador)
        "color-contrast": { enabled: false },
        "target-size": { enabled: false },
        "scrollable-region-focusable": { enabled: false },
        // (el documento de prueba no es la página real: idioma y título los pone index.html)
        "html-has-lang": { enabled: false },
        "document-title": { enabled: false },
        "page-has-heading-one": { enabled: false },
      },
    });
    const problems = result.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
    expect(problems).toEqual([]);
  });
});

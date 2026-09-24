import { AccessDeniedError, DomainError } from "../../domain/errors";
import {
  formatPrice,
  SMOKE_LABELS,
  type ContentAnalysis,
  type Correction,
  type CredibilityReport,
  type EvidenceSnapshot,
  type Rebuttal,
  type Plan,
  type ResponseContent,
  type SavedRuleSet,
  type SmokeAnalysis,
  type SourceComparison,
  type EffectivePreferences,
  type ResponseFormat,
} from "../../domain/model";
import type { IOutletReader } from "../../domain/ports";

const pct = (n: number | null) => (n === null ? "sin datos" : `${Math.round(n * 100)}/100`);
const ICON = { ok: "✅", info: "ℹ️", warning: "⚠️", danger: "⛔" } as const;

/**
 * Convierte resultados del dominio en una respuesta NEUTRA (ResponseContent).
 * No sabe de canales: cada renderer la dibuja a su manera.
 */
/** Pregunta de calidad al pie de cada análisis (la respuesta alimenta la evaluación del algoritmo). */
export const FEEDBACK_ASK = "¿Te sirvió? Respondé SÍ o NO.";

export class ResponseComposer {
  constructor(private readonly outlets: IOutletReader) {}

  smoke(a: SmokeAnalysis): ResponseContent {
    return {
      kind: "result",
      title: `Índice de humo: ${a.smokeIndex}/100`,
      summary:
        a.cleanVersion ||
        (a.findings.some((f) => f.type === "unsourced_claim" || f.type === "alarmism")
          ? "Ningún dato del texto tiene respaldo: las cifras que aparecen vienen de rumores o frases alarmistas."
          : "No se encontraron datos concretos en el texto."),
      sections: a.findings.length
        ? [{ heading: "Humo detectado", lines: dedupe(a.findings.map((f) => `${SMOKE_LABELS[f.type]}: "${f.excerpt}"`)) }]
        : [],
      links: [],
    };
  }

  content(a: ContentAnalysis): ResponseContent {
    const base = this.smoke(a.smoke);
    const signals = a.signals.map((s) => `${ICON[s.level]} ${s.label}: ${s.detail}`);
    const known = a.links.filter((l) => l.outletId).length;
    return {
      ...base,
      title: `${a.item.title ? `"${truncate(a.item.title, 60)}" · ` : ""}${base.title}`,
      sections: [
        ...(signals.length ? [{ heading: "Sobre la fuente", lines: signals }] : []),
        ...base.sections,
        ...(a.links.length ? [{ heading: "Links", lines: [`${a.links.length} link(s), ${known} a medios conocidos: ${dedupe(a.links.map((l) => l.domain)).slice(0, 5).join(", ")}`] }] : []),
      ],
      footer: [base.footer, FEEDBACK_ASK].filter(Boolean).join(" "),
    };
  }

  async comparison(c: SourceComparison & { blockedIncludes?: string[] }): Promise<ResponseContent> {
    const name = await this.outletNamer();
    const sections: ResponseContent["sections"] = [];
    if (c.agreements.length) sections.push({ heading: "Coinciden todas", lines: c.agreements.map((x) => x.summary) });
    if (c.partialAgreements.length) sections.push({ heading: "Coinciden varias", lines: c.partialAgreements.map((x) => `${x.summary} (${x.outletIds.map(name).join(", ")})`) });
    if (c.disagreements.length) {
      sections.push({
        heading: "Difieren",
        lines: c.disagreements.map((d) => `[${d.type === "factual" ? "dato" : d.type === "interpretive" ? "interpretación" : "valores"}] ${d.description}`),
      });
    }
    if (c.openQuestions.length) sections.push({ heading: "Para verificar", lines: c.openQuestions });
    const notes = [
      ...(c.urlRules.failedIncludes.map((f) => `No se pudo incluir ${f.url}`)),
      ...((c.blockedIncludes ?? []).map((u) => `Tu organización excluye ${u}`)),
    ];
    if (notes.length) sections.push({ heading: "Notas", lines: notes });
    return {
      kind: "result",
      title: `Comparación: ${c.topic}`,
      summary: `${c.outletIds.length} fuentes: ${c.outletIds.map(name).join(", ")}.`,
      sections,
      links: c.articleUrls.slice(0, 8).map((u) => ({ label: new URL(u).hostname.replace(/^www\./, ""), url: u })),
    };
  }

  credibility(r: CredibilityReport & { rebuttals?: Rebuttal[]; corrections?: Correction[] }): ResponseContent {
    const state = { submitted: "en revisión", accepted: "aceptada", partially_accepted: "aceptada en parte", rejected: "no aceptada" } as const;
    const rebuttals = (r.rebuttals ?? []).slice(0, 3).map((x) => `(${state[x.status]}) ${x.statement.length > 200 ? `${x.statement.slice(0, 199)}…` : x.statement}`);
    const corrections = (r.corrections ?? []).slice(0, 3).map((c) => c.description);
    return {
      kind: "result",
      title: `Credibilidad de ${r.outletName} en "${r.query.topic}"`,
      summary: `Resumen: ${pct(r.overall)} · ${r.sampleSize} notas analizadas.`,
      sections: [
        { lines: r.dimensions.map((d) => `${d.label}: ${pct(d.score)} — ${d.summary}`) },
        ...(rebuttals.length ? [{ heading: "Réplica del medio", lines: rebuttals }] : []),
        ...(corrections.length ? [{ heading: "Correcciones de Sin Humo", lines: corrections }] : []),
      ],
      links: [],
      footer: r.disclaimer,
    };
  }

  plan(plan: Plan, usage: { analyses: number; comparisons: number }): ResponseContent {
    const lim = (n: number | null) => (n === null ? "ilimitado" : String(n));
    return {
      kind: "info",
      title: `Tu plan: ${plan.name} (${formatPrice(plan.price)})`,
      summary: plan.description,
      sections: [{
        lines: [
          `Análisis hoy: ${usage.analyses} de ${lim(plan.limits.analysesPerDay)}`,
          `Comparaciones este mes: ${usage.comparisons} de ${lim(plan.limits.comparisonsPerMonth)}`,
          `Canales: ${plan.channels.join(", ")}`,
        ],
      }],
      links: [],
    };
  }

  rules(sets: SavedRuleSet[]): ResponseContent {
    return {
      kind: "info",
      title: "Tus reglas",
      summary: sets.length ? undefined : "No tenés reglas guardadas. Ej.: /excluir sitio.com",
      sections: sets.map((s) => ({ heading: `${s.name}${s.owner.type === "organization" ? " (organización)" : ""}`, lines: [`Excluye: ${(s.urlRules.exclude ?? []).join(", ") || "-"}`] })),
      links: [],
    };
  }

  help(): ResponseContent {
    return {
      kind: "info",
      title: "Sin Humo: cómo usarlo",
      sections: [{
        lines: [
          "Reenviá un mensaje, una nota o un mail → te devuelvo los hechos y el humo.",
          "/comparar <tema> [AAAA-MM] [links] → qué dicen distintas fuentes.",
          "/credibilidad <medio> | <tema> → credibilidad de un medio en un tema.",
          "/excluir <sitio> → no usar ese sitio nunca.",
          "/seguir <tema> · /dejar <tema> · /temas → los temas que te interesan.",
          "/formato corto | detallado | fácil · /audio si | no · /silencio 22-8 (o /silencio no) · /preferencias",
          "/jugar → ¿esto es humo? (practicá) · /progreso · /aula <código> <apodo>",
          "/invitar → tu código para invitar · /codigo <código> → usar una invitación",
          "/soporte <tu consulta> → hablar con una persona · /tickets",
          "/guardar <link> [seguir] → copia de la nota con sello de tiempo (y aviso si la editan o la borran)",
          "/reglas · /plan · /ayuda · BAJA (dejar de recibir avisos)",
        ],
      }],
      links: [],
    };
  }

  /**
   * Aplica el formato que eligió la persona.
   *  - detallado: todo;
   *  - corto: título, resumen y lo principal (3 líneas, 2 links);
   *  - lectura fácil: como el corto, en frases simples (la reescritura completa llega en el 4D).
   */
  format(c: ResponseContent, format: ResponseFormat): ResponseContent {
    if (format === "detailed" || c.kind !== "result") return c;
    const lines = c.sections.flatMap((s) => s.lines).slice(0, 3);
    return {
      ...c,
      sections: lines.length ? [{ heading: format === "easy_read" ? "Lo más importante" : undefined, lines }] : [],
      links: c.links.slice(0, 2),
      footer: format === "easy_read" ? [c.footer, "Pedí /formato detallado para ver todo."].filter(Boolean).join(" ") : c.footer,
    };
  }

  preferences(p: EffectivePreferences, topicNames: string[]): ResponseContent {
    const fmt = { short: "corto", detailed: "detallado", easy_read: "lectura fácil" }[p.responseFormat];
    const lock = (k: keyof EffectivePreferences["source"]) => (p.source[k] === "locked" ? " (fijado por tu organización)" : "");
    return {
      kind: "info",
      title: "Tus preferencias",
      sections: [{
        lines: [
          `Temas que seguís: ${topicNames.join(", ") || "ninguno (/seguir <tema>)"}`,
          `Formato de respuesta: ${fmt}${lock("responseFormat")}`,
          `Horario de silencio: ${p.quietHours ? `${p.quietHours.from} a ${p.quietHours.to}` : "no"}${lock("quietHours")}`,
          `Resumen: ${{ off: "no", daily: "diario", weekly: "semanal" }[p.digest]}${lock("digest")}`,
        ],
      }],
      links: [],
    };
  }

  topics(tree: { path: string; topics: { name: string; synonyms: string[] }[] }[], followed: string[]): ResponseContent {
    return {
      kind: "info",
      title: "Temas",
      summary: "Escribí /seguir <tema> para recibir novedades. ✓ = ya lo seguís.",
      sections: tree.filter((c) => c.topics.length).map((c) => ({
        heading: c.path,
        lines: c.topics.map((t) => `${followed.includes(t.name) ? "✓ " : ""}${t.name}${t.synonyms.length ? ` (también: ${t.synonyms.slice(0, 3).join(", ")})` : ""}`),
      })),
      links: [],
    };
  }

  /** Resultado de archivar una nota: huella, fecha, seguimiento y qué cambió desde la copia anterior. */
  evidence(s: EvidenceSnapshot): ResponseContent {
    const when = `${s.capturedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
    if (s.status === "failed") return { kind: "error", title: "No pude guardar la copia", summary: s.error ?? "La página no respondió.", sections: [], links: [] };
    if (s.status === "gone") {
      return { kind: "info", title: "La página ya no existe", summary: `Quedó registrado que el ${when} respondió ${s.httpStatus}. Código: ${s.id}.`, sections: [], links: [] };
    }
    const sections: ResponseContent["sections"] = [{
      lines: [
        `Fecha: ${when}`,
        `Huella (SHA-256): ${s.rawSha256!.slice(0, 16)}…`,
        `Código: ${s.id}`,
        ...(s.monitorUntil ? [`La vuelvo a mirar hasta el ${s.monitorUntil.toISOString().slice(0, 10)} para detectar si la editan o la borran.`] : []),
      ],
    }];
    if (s.change && (s.change.added.length || s.change.removed.length)) {
      sections.push({
        heading: "Cambió desde la copia anterior",
        lines: [...s.change.removed.slice(0, 3).map((x) => `− ${x}`), ...s.change.added.slice(0, 3).map((x) => `+ ${x}`)],
      });
    }
    return { kind: "info", title: "Guardé una copia de la nota", summary: s.title, sections, links: [], footer: "El sello de tiempo y la copia pública se agregan en unos minutos." };
  }

  info(title: string, summary?: string): ResponseContent {
    return { kind: "info", title, summary, sections: [], links: [] };
  }

  error(err: unknown): ResponseContent {
    if (err instanceof AccessDeniedError) {
      return { kind: "denied", title: "No se pudo completar", summary: err.message, sections: [], links: [], footer: err.upgradeHint };
    }
    if (err instanceof DomainError) return { kind: "error", title: "No se pudo completar", summary: err.message, sections: [], links: [] };
    return { kind: "error", title: "Ocurrió un error", summary: "Probá de nuevo en unos minutos.", sections: [], links: [] };
  }

  private async outletNamer() {
    const all = await this.outlets.findAll();
    return (id: string) => all.find((o) => o.id === id)?.name ?? id.replace(/^web:/, "");
  }
}

const dedupe = <T>(xs: T[]) => [...new Set(xs)];
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

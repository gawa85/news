import { AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import type { OpenDatasetInfo, Period, Permission, StatCounter } from "../../domain/model";
import type {
  IAuthorizationService,
  ICatalogRepository,
  IContentAnalysisRepository,
  IOpenDataset,
  IOutletReader,
  IStatsRepository,
  IUserRepository,
} from "../../domain/ports";
import type { AccessControl } from "../access/AccessControl";
import { statMonth, type StatsService } from "./Stats";

const LICENSE = "CC BY 4.0 (citar: Sin Humo, Observatorio)";

// ---------------- Datasets abiertos (uno por clase) ----------------

/** Humo por tipo, mes a mes (anonimizado igual que el observatorio). */
export class SmokeByTypeDataset implements IOpenDataset {
  readonly info: OpenDatasetInfo = {
    id: "humo-por-tipo",
    title: "Humo detectado por tipo y mes",
    description: "Cuántos análisis encontraron cada tipo de humo (adjetivos inflados, alarmismo, cadenas…). Grupos con menos personas que el mínimo se omiten; valores redondeados.",
    license: LICENSE,
    updateFrequency: "diaria",
    columns: [
      { name: "mes", description: "AAAA-MM" },
      { name: "tipo", description: "Tipo de humo" },
      { name: "analisis", description: "Cantidad de análisis (redondeada)" },
    ],
  };

  constructor(private readonly stats: StatsService) {}

  async rows(period: Period) {
    const out: Record<string, string | number | null>[] = [];
    for (const month of monthsIn(period)) {
      const r = await this.stats.observatory(month);
      for (const t of r.smokeTypes) out.push({ mes: month, tipo: t.type, analisis: t.count });
    }
    return out;
  }
}

/** Cadenas en circulación (texto con datos personales ocultos). */
export class NarrativesDataset implements IOpenDataset {
  readonly info: OpenDatasetInfo = {
    id: "cadenas-en-circulacion",
    title: "Cadenas y narrativas en circulación",
    description: "Mensajes que muchas personas distintas pidieron analizar, agrupados por similitud, con teléfonos y mails ocultos. Indica si hubo campaña para contrarrestarlos.",
    license: LICENSE,
    updateFrequency: "diaria",
    columns: [
      { name: "mes", description: "AAAA-MM" },
      { name: "id", description: "Identificador estable de la narrativa" },
      { name: "muestra", description: "Texto de muestra (redactado)" },
      { name: "apariciones", description: "Veces que se pidió analizar (redondeado)" },
      { name: "primera_vez", description: "Fecha de primera aparición" },
      { name: "contrarrestada", description: "sí / no" },
    ],
  };

  constructor(private readonly stats: StatsService) {}

  async rows(period: Period) {
    const out: Record<string, string | number | null>[] = [];
    for (const month of monthsIn(period)) {
      for (const n of (await this.stats.observatory(month)).narratives) {
        out.push({ mes: month, id: n.id, muestra: n.sample, apariciones: n.occurrences, primera_vez: n.firstSeen.toISOString().slice(0, 10), contrarrestada: n.countered ? "sí" : "no" });
      }
    }
    return out;
  }
}

/** Pauta oficial por medio (datos que ya son públicos, reunidos y asociados a cada medio). */
export class OfficialAdvertisingDataset implements IOpenDataset {
  readonly info: OpenDatasetInfo = {
    id: "pauta-oficial",
    title: "Pauta oficial por medio",
    description: "Montos de publicidad oficial asignados a cada medio del catálogo, con la fuente original de cada dato.",
    license: LICENSE,
    updateFrequency: "cuando se importa un dataset nuevo",
    columns: [
      { name: "medio", description: "Nombre del medio" },
      { name: "pagador", description: "Organismo que paga" },
      { name: "jurisdiccion", description: "national / provincial / municipal" },
      { name: "desde", description: "Inicio del período" },
      { name: "hasta", description: "Fin del período" },
      { name: "monto", description: "Monto" },
      { name: "moneda", description: "Moneda" },
      { name: "fuente", description: "De dónde sale el dato" },
    ],
  };

  constructor(
    private readonly catalog: ICatalogRepository,
    private readonly outlets: IOutletReader,
  ) {}

  async rows(period: Period) {
    const out: Record<string, string | number | null>[] = [];
    for (const o of await this.outlets.findAll()) {
      for (const a of await this.catalog.findAdvertising(o.id, period)) {
        out.push({
          medio: o.name, pagador: a.payer, jurisdiccion: a.jurisdiction, desde: a.period.from.toISOString().slice(0, 10),
          hasta: a.period.to.toISOString().slice(0, 10), monto: a.amount, moneda: a.currency, fuente: a.source ?? null,
        });
      }
    }
    return out;
  }
}

/** Catálogo de datos abiertos. */
export class OpenDataService {
  constructor(private readonly datasets: IOpenDataset[]) {}

  list(): OpenDatasetInfo[] {
    return this.datasets.map((d) => d.info);
  }

  async get(id: string, period: Period): Promise<{ info: OpenDatasetInfo; rows: Record<string, string | number | null>[] }> {
    const d = this.datasets.find((x) => x.info.id === id);
    if (!d) throw new NotFoundError(`No existe el dataset ${id}.`);
    if (monthsIn(period).length > 24) throw new ValidationError("Pedí como máximo 24 meses por vez.");
    return { info: d.info, rows: await d.rows(period) };
  }
}

function monthsIn(p: Period): string[] {
  const out: string[] = [];
  const last = statMonth(p.to);
  let [y, m] = statMonth(p.from).split("-").map(Number) as [number, number];
  for (let i = 0; i < 1000; i++) {
    const cur = `${y}-${String(m).padStart(2, "0")}`;
    out.push(cur);
    if (cur >= last) break;
    m++;
    if (m > 12) (m = 1), y++;
  }
  return out;
}

// ---------------- Conexión con BI ----------------

export type BiDataset = "analyses" | "daily_stats";

/**
 * FEED PARA BI (Power BI, Looker Studio, Metabase, una planilla…): filas planas e
 * INCREMENTALES (`since` + cursor), para que la herramienta traiga sólo lo nuevo.
 * REGLAS: plan con `bi_feed`; lo propio siempre; lo de la organización con `stats:org`.
 * Sin textos de los mensajes: sólo metadatos y resultados.
 */
export class BiFeedService {
  constructor(
    private readonly analyses: IContentAnalysisRepository,
    private readonly stats: IStatsRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
  ) {}

  async rows(input: { actorId: string; dataset: BiDataset; scope: "user" | "organization"; since: Date; limit?: number; /** Alcances de la clave de API, si se usa una. */ scopes?: ReadonlySet<Permission> }): Promise<{ rows: Record<string, string | number | null>[]; nextSince: string | null }> {
    const actor = await this.access.userOrThrow(input.actorId);
    const { plan } = await this.access.planOf(actor);
    if (!plan.features.includes("bi_feed")) throw new AccessDeniedError(`La conexión con BI no está incluida en el plan ${plan.name}.`, "feature_not_in_plan");
    let userIds = [actor.id];
    let scopeId = actor.id;
    if (input.scope === "organization") {
      if (!actor.organizationId) throw new ValidationError("No pertenecés a ninguna organización.");
      if (!(await this.authz.permissionsOf(actor)).has("stats:org") || (input.scopes && !input.scopes.has("stats:org"))) throw new AccessDeniedError("No tenés permiso para ver los datos de la organización.", "no_permission");
      userIds = (await this.users.findByOrganization(actor.organizationId)).map((u) => u.id);
      scopeId = actor.organizationId;
    }
    const limit = Math.min(Math.max(input.limit ?? 1000, 1), 5000);

    if (input.dataset === "analyses") {
      const items = await this.analyses.findByUsersSince(userIds, input.since, limit);
      return {
        rows: items.map((a) => ({
          id: a.id, fecha: a.analyzedAt.toISOString(), usuario: a.userId, origen: a.item.sourceType, dominio: a.item.origin.domain ?? null,
          indice_humo: a.smoke.smokeIndex, tipos_humo: [...new Set(a.smoke.findings.map((f) => f.type))].join("|"),
          links: a.links.length, links_a_medios: a.links.filter((l) => l.outletId).length, version_algoritmo: a.modelVersion ?? null,
        })),
        // Cursor: la fecha del último + 1 ms (el orden es por fecha ascendente).
        nextSince: items.length === limit ? new Date(items.at(-1)!.analyzedAt.getTime() + 1).toISOString() : null,
      };
    }
    const rows: StatCounter[] = await this.stats.find({ scope: input.scope, scopeId, fromDay: input.since.toISOString().slice(0, 10), toDay: "9999-12-31" });
    return {
      rows: rows.sort((a, b) => a.day.localeCompare(b.day)).map((r) => ({ dia: r.day, metrica: r.metric, dimension: r.dim || null, valor: r.value })),
      nextSince: null,
    };
  }
}

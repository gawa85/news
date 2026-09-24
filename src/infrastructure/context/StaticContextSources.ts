/**
 * Fuentes de contexto cargadas desde datos estáticos (JSON, carga manual).
 * En producción se reemplazan por adaptadores que lean registros públicos de
 * propiedad de medios, datos de pauta oficial publicados por cada gobierno, etc.
 */
import {
  regionContains,
  type AdvertisingSpend,
  type Owner,
  type OwnershipRecord,
  type Period,
  type PoliticalContext,
  type Region,
} from "../../domain/model";
import type {
  IOfficialAdvertisingSource,
  IOwnershipRegistry,
  IPoliticalContextProvider,
  ITopicSectorMapper,
} from "../../domain/ports";
import { normalize } from "../heuristics/text";

export class StaticOwnershipRegistry implements IOwnershipRegistry {
  constructor(
    private readonly owners: Owner[],
    private readonly records: OwnershipRecord[],
  ) {}

  async ownersAt(outletId: string, date: Date): Promise<Owner[]> {
    const ids = this.records
      .filter((r) => r.outletId === outletId && r.since <= date && (!r.until || r.until >= date))
      .map((r) => r.ownerId);
    return this.owners.filter((o) => ids.includes(o.id));
  }
}

export class StaticAdvertisingSource implements IOfficialAdvertisingSource {
  constructor(private readonly spends: AdvertisingSpend[]) {}

  async spendFor(outletId: string, period: Period): Promise<AdvertisingSpend[]> {
    return this.spends.filter(
      (s) => s.outletId === outletId && s.period.from <= period.to && s.period.to >= period.from,
    );
  }
}

export interface RegionalContext {
  region: Region;
  governingForces: PoliticalContext["governingForces"];
  events: PoliticalContext["events"];
}

export class StaticPoliticalContextProvider implements IPoliticalContextProvider {
  constructor(private readonly contexts: RegionalContext[]) {}

  /** Junta el contexto nacional + provincial + local que aplica a la región. */
  async contextFor(region: Region, period: Period): Promise<PoliticalContext> {
    const applicable = this.contexts.filter((c) => regionContains(c.region, region));
    return {
      region,
      period,
      governingForces: applicable
        .flatMap((c) => c.governingForces)
        .filter((g) => g.from <= period.to && (!g.to || g.to >= period.from)),
      events: applicable
        .flatMap((c) => c.events)
        .filter((e) => e.date >= period.from && e.date <= period.to)
        .sort((a, b) => a.date.getTime() - b.date.getTime()),
    };
  }
}

export class KeywordTopicSectorMapper implements ITopicSectorMapper {
  constructor(private readonly map: Record<string, string[]>) {}

  sectorsFor(topic: string): string[] {
    const t = normalize(topic);
    return [...new Set(Object.entries(this.map).filter(([k]) => t.includes(normalize(k))).flatMap(([, v]) => v))];
  }
}

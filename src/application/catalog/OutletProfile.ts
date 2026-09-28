import { NotFoundError } from "../../domain/errors";
import type { Outlet } from "../../domain/model";
import type { IClock, ICatalogRepository, IOutletReader } from "../../domain/ports";
import type { PublicCorrection, PublicRebuttal, RebuttalService } from "../rebuttals/Rebuttals";

export interface OutletProfile {
  outlet: Pick<Outlet, "id" | "name" | "url" | "kind" | "region">;
  /** Dueños (vigentes primero) con desde cuándo y de dónde sale el dato. */
  owners: { name: string; businessSectors: string[]; since: Date; until?: Date; source?: string }[];
  /** Pauta oficial de los últimos 12 meses, por quién paga (una fila por pagador y moneda). */
  advertising: { payer: string; jurisdiction: string; amount: number; currency: string; source?: string }[];
  rebuttals: PublicRebuttal[];
  corrections: PublicCorrection[];
}

/**
 * FICHA PÚBLICA DE UN MEDIO: quién es su dueño, cuánta pauta oficial recibe y su historial de
 * réplicas y fe de erratas. Son datos públicos (registros, datasets de gobiernos, el propio medio):
 * se muestran siempre con su fuente. La credibilidad calculada va aparte (según el plan).
 */
export class OutletProfileService {
  constructor(
    private readonly outlets: IOutletReader,
    private readonly catalog: ICatalogRepository,
    private readonly rebuttals: RebuttalService,
    private readonly clock: IClock,
  ) {}

  async profile(outletId: string): Promise<OutletProfile> {
    const o = await this.outlets.findById(outletId);
    if (!o) throw new NotFoundError("No existe ese medio.");
    const ownership = (await this.catalog.findOwnership(o.id)).sort((a, b) => Number(!!a.until) - Number(!!b.until) || b.since.getTime() - a.since.getTime());
    const owners = await this.catalog.findOwners(ownership.map((r) => r.ownerId));
    const now = this.clock.now();
    const spend = await this.catalog.findAdvertising(o.id, { from: new Date(now.getTime() - 365 * 86_400_000), to: now });
    const byPayer = new Map<string, OutletProfile["advertising"][number]>();
    for (const a of spend) {
      const key = `${a.payer}|${a.currency}`;
      const prev = byPayer.get(key);
      byPayer.set(key, { payer: a.payer, jurisdiction: a.jurisdiction, currency: a.currency, amount: (prev?.amount ?? 0) + a.amount, source: prev?.source ?? a.source });
    }
    const record = await this.rebuttals.publicRecord(o.id);
    return {
      outlet: { id: o.id, name: o.name, url: o.url, kind: o.kind, region: o.region },
      owners: ownership.map((r) => {
        const owner = owners.find((x) => x.id === r.ownerId);
        return { name: owner?.name ?? r.ownerId, businessSectors: owner?.businessSectors ?? [], since: r.since, until: r.until, source: r.source };
      }),
      advertising: [...byPayer.values()].sort((a, b) => b.amount - a.amount),
      ...record,
    };
  }
}

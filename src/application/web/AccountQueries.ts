import { NotFoundError } from "../../domain/errors";
import type { ContentAnalysis, Feature, Plan, SocialPost } from "../../domain/model";
import type { IContentAnalysisRepository, IOutletReader, IPlanRepository } from "../../domain/ports";
import type { AccessControl } from "../access/AccessControl";
import type { LegalService } from "../legal/Legal";

/** Lo que la web muestra de un análisis (sin datos internos: modelo, id de la persona…). */
export interface AnalysisView {
  id: string;
  at: Date;
  sourceType: ContentAnalysis["item"]["sourceType"];
  title?: string;
  text: string;
  smokeIndex: number;
  facts: string[];
  findings: ContentAnalysis["smoke"]["findings"];
  cleanVersion: string;
  signals: ContentAnalysis["signals"];
  links: ContentAnalysis["links"];
  /** Si el texto salió de una publicación de una red. */
  post?: Pick<SocialPost, "platform" | "url" | "author" | "publishedAt" | "metrics">;
}

export interface AnalysisSummary {
  id: string;
  at: Date;
  sourceType: string;
  title?: string;
  excerpt: string;
  smokeIndex: number;
  findings: number;
}

export interface PublicPlan {
  id: string;
  name: string;
  description: string;
  tier: number;
  price: Plan["price"];
  yearlyPrice?: Plan["yearlyPrice"];
  features: { id: Feature; label: string }[];
  limits: Plan["limits"];
}

/**
 * CONSULTAS DE LA WEB de personas: lo que muestra la cuenta, el historial y la portada.
 * Sólo lectura y sólo lo que hace falta mostrar (cada método arma su vista).
 */
export class AccountQueries {
  constructor(
    private readonly access: AccessControl,
    private readonly legal: LegalService,
    private readonly analyses: IContentAnalysisRepository,
    private readonly plans: IPlanRepository,
    private readonly outlets: IOutletReader,
    private readonly featureLabels: Record<Feature, string>,
  ) {}

  /** Quién soy: datos de la cuenta, plan, uso de hoy y documentos legales por aceptar. */
  async me(userId: string) {
    const user = await this.access.userOrThrow(userId);
    const { plan } = await this.access.planOf(user);
    return {
      id: user.id,
      name: user.name,
      country: user.country,
      createdAt: user.createdAt,
      organizationId: user.organizationId,
      roles: user.roleIds,
      channels: user.channels.map((c) => ({ type: c.channel, address: c.address, verified: c.verified })),
      plan: { id: plan.id, name: plan.name, features: plan.features, limits: plan.limits, price: plan.price },
      usage: await this.access.usageOf(user),
      pendingLegal: await this.legal.pendingFor(user.id),
    };
  }

  async history(userId: string, limit = 30): Promise<AnalysisSummary[]> {
    const list = await this.analyses.findByUser(userId, Math.min(Math.max(1, limit), 100));
    return list.map((a) => ({
      id: a.id,
      at: a.analyzedAt,
      sourceType: a.item.sourceType,
      title: a.item.title,
      excerpt: a.item.text.length > 160 ? `${a.item.text.slice(0, 159)}…` : a.item.text,
      smokeIndex: a.smoke.smokeIndex,
      findings: a.smoke.findings.length,
    }));
  }

  /** Un análisis propio (de otra persona: no existe). */
  async analysis(userId: string, id: string): Promise<AnalysisView> {
    const a = await this.analyses.findById(id);
    if (!a || a.userId !== userId) throw new NotFoundError("No existe ese análisis.");
    return AccountQueries.view(a);
  }

  static view(a: ContentAnalysis, post?: SocialPost): AnalysisView {
    return {
      id: a.id,
      at: a.analyzedAt,
      sourceType: a.item.sourceType,
      title: a.item.title,
      text: a.item.text,
      smokeIndex: a.smoke.smokeIndex,
      facts: a.smoke.facts,
      findings: a.smoke.findings,
      cleanVersion: a.smoke.cleanVersion,
      signals: a.signals,
      links: a.links,
      ...(post ? { post: { platform: post.platform, url: post.url, author: post.author, publishedAt: post.publishedAt, metrics: post.metrics } } : {}),
    };
  }

  /** Planes para personas (la página de precios; los de organizaciones se venden aparte). */
  async publicPlans(): Promise<PublicPlan[]> {
    return (await this.plans.findAll())
      .filter((p) => p.audience === "individual")
      .sort((a, b) => a.tier - b.tier)
      .map((p) => ({
        id: p.id, name: p.name, description: p.description, tier: p.tier, price: p.price, yearlyPrice: p.yearlyPrice,
        features: p.features.map((f) => ({ id: f, label: this.featureLabels[f] ?? f })), limits: p.limits,
      }));
  }

  /** Medios del catálogo (para elegir uno en "credibilidad"). */
  async publicOutlets() {
    return (await this.outlets.findAll())
      .map((o) => ({ id: o.id, name: o.name, url: o.url, kind: o.kind, region: o.region }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }
}

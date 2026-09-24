/**
 * Reseñas de OTRAS plataformas (sólo lectura) y moderación de reseñas propias.
 */
import type { ExternalReview } from "../../domain/model";
import type { IHttpClient, IReviewModerator, IReviewSource, ModerationVerdict } from "../../domain/ports";

/** App Store: feed público de reseñas de una app. Config: { appId, country }. */
export class AppStoreReviewSource implements IReviewSource {
  readonly platform = "appstore";

  constructor(private readonly http: IHttpClient) {}

  async pull(config: Record<string, string>): Promise<{ reviews: ExternalReview[] }> {
    const url = `https://itunes.apple.com/${config.country ?? "ar"}/rss/customerreviews/id=${config.appId}/sortBy=mostRecent/json`;
    const res = await this.http.get(url);
    if (res.status !== 200) throw new Error(`App Store respondió ${res.status}`);
    type L = { label: string };
    const entries = (JSON.parse(res.text) as { feed?: { entry?: { id: L; author: { name: L }; "im:rating"?: L; title?: L; content?: L; updated?: L }[] } }).feed?.entry ?? [];
    return {
      reviews: entries
        .filter((e) => e["im:rating"]) // el primer ítem puede ser la ficha de la app
        .map((e) => ({
          platform: this.platform,
          externalId: e.id.label,
          author: e.author.name.label,
          rating: Number(e["im:rating"]!.label),
          scale: 5,
          text: [e.title?.label, e.content?.label].filter(Boolean).join(". "),
          createdAt: new Date(e.updated?.label ?? 0),
        })),
    };
  }
}

/**
 * Google Play (API oficial "reviews.list" de Android Publisher, requiere token OAuth
 * de la cuenta de desarrollador). Config: { packageName, accessToken }.
 */
export class GooglePlayReviewSource implements IReviewSource {
  readonly platform = "googleplay";

  constructor(private readonly http: IHttpClient) {}

  async pull(config: Record<string, string>, cursor?: string): Promise<{ reviews: ExternalReview[]; cursor?: string }> {
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${config.packageName}/reviews${cursor ? `?token=${encodeURIComponent(cursor)}` : ""}`;
    const res = await this.http.get(url, { authorization: `Bearer ${config.accessToken}` });
    if (res.status !== 200) throw new Error(`Google Play respondió ${res.status}`);
    const data = JSON.parse(res.text) as {
      reviews?: { reviewId: string; authorName?: string; comments?: { userComment?: { text?: string; starRating?: number; lastModified?: { seconds: string } } }[] }[];
      tokenPagination?: { nextPageToken?: string };
    };
    return {
      reviews: (data.reviews ?? []).map((r) => {
        const c = r.comments?.[0]?.userComment;
        return {
          platform: this.platform,
          externalId: r.reviewId,
          author: r.authorName,
          rating: c?.starRating ?? null,
          scale: 5,
          text: c?.text?.trim(),
          createdAt: new Date(Number(c?.lastModified?.seconds ?? 0) * 1000),
        };
      }),
      cursor: data.tokenPagination?.nextPageToken,
    };
  }
}

/** Raíces (sin tildes): "idiota" también detecta "idiotas". */
const INSULTS = ["idiot", "imbecil", "estupid", "pelotud", "boludo", "forro", "hdp", "mierda"];

/**
 * Moderación por reglas: insultos → rechazo; links, mails o teléfonos (spam o datos
 * personales) → revisión humana. Reemplazable por un moderador con IA.
 */
export class RuleBasedReviewModerator implements IReviewModerator {
  async moderate(text: string): Promise<{ verdict: ModerationVerdict; reason?: string }> {
    const t = text.toLowerCase();
    const plain = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (INSULTS.some((w) => new RegExp(`(^|[^a-z])${w}[a-z]*`).test(plain))) return { verdict: "reject", reason: "lenguaje ofensivo" };
    if (/https?:\/\/|www\./.test(t)) return { verdict: "review", reason: "contiene links" };
    if (/[\w.+-]+@[\w-]+\.\w+/.test(t) || /(\+?\d[\d\s-]{7,}\d)/.test(t)) return { verdict: "review", reason: "posibles datos personales" };
    if (text.length > 2000) return { verdict: "review", reason: "demasiado largo" };
    return { verdict: "approve" };
  }
}

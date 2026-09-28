import type {
  Analysis,
  AnalysisSummary,
  AuthOptions,
  CategoryNode,
  Checkout,
  Comparison,
  CredibilityReport,
  Me,
  Outlet,
  Preferences,
  PublicPlan,
  Quote,
  Topic,
} from "./types";

/**
 * Lo que la web necesita del servidor (puerto). Las pantallas dependen de esta interfaz,
 * nunca de fetch: en las pruebas se usa una implementación falsa (DIP).
 */
export interface SinHumoApi {
  // Acceso
  authOptions(): Promise<AuthOptions>;
  requestMagicLink(email: string, captchaToken?: string): Promise<void>;
  loginWithPassword(email: string, password: string, captchaToken?: string): Promise<void>;
  logout(everywhere?: boolean): Promise<void>;
  /** undefined = sin sesión. */
  me(): Promise<Me | undefined>;

  // Análisis
  analyze(text: string): Promise<Analysis>;
  history(limit?: number): Promise<AnalysisSummary[]>;
  analysis(id: string): Promise<Analysis>;
  feedback(analysisId: string, useful: boolean, reason?: string, comment?: string): Promise<void>;
  compare(input: { topic: string; from: string; to: string; include?: string[] }): Promise<Comparison>;
  credibility(input: { outletId: string; topic: string; from: string; to: string }): Promise<CredibilityReport>;

  // Catálogo público
  topics(): Promise<CategoryNode[]>;
  outlets(): Promise<Outlet[]>;
  plans(): Promise<PublicPlan[]>;

  // Cuenta
  preferences(): Promise<Preferences>;
  updatePreferences(values: Partial<Omit<Preferences, "source" | "followedTopics">>): Promise<Preferences>;
  follow(topic: string): Promise<Topic>;
  unfollow(topic: string): Promise<Topic>;
  quote(planId: string, interval: "month" | "year", coupon?: string): Promise<Quote>;
  checkout(planId: string, interval: "month" | "year", couponCode?: string): Promise<Checkout>;
  /** Cancelar: sigue hasta el fin del período pagado. Retomar: deshace la cancelación. */
  cancelSubscription(): Promise<void>;
  resumeSubscription(): Promise<void>;
  acceptLegal(docId: string, version: string): Promise<void>;
  deleteAccount(confirmation: string): Promise<void>;
  /** Link para bajar todos mis datos (Ley 25.326). */
  myDataUrl(): string;
}

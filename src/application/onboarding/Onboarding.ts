import { NotFoundError, ValidationError } from "../../domain/errors";
import type { User } from "../../domain/model";
import type { IAuthorizationService, IClock, IContentAnalysisRepository, IOrganizationInvitationRepository, IUserRepository } from "../../domain/ports";

export type OnboardingStepId = "topics" | "chat" | "notifications" | "first_analysis" | "team";

export interface OnboardingStatus {
  steps: { id: OnboardingStepId; done: boolean; skipped: boolean }[];
  /** Cuántos pasos faltan (sin contar los salteados). */
  pending: number;
  /** La persona cerró la guía ("no mostrar más") o la terminó. */
  dismissed: boolean;
}

/** Lo que la guía necesita saber de las preferencias (puerto chico: no depende del servicio entero). */
export interface OnboardingPreferences {
  followedTopics(user: User): Promise<string[]>;
}

/**
 * GUÍA DE BIENVENIDA: los primeros pasos para dejar la cuenta configurada.
 * REGLAS:
 *  - Cada paso sale del estado real cuando se puede (sigue temas, tiene un chat vinculado, ya hizo
 *    un análisis, su organización tiene más gente): nunca dice "falta" algo que ya está hecho.
 *  - "Cómo y cuándo avisarte" se marca al guardarlo (no hay un estado que lo demuestre).
 *  - Cualquier paso se puede saltear; la guía se puede cerrar. Nada de esto limita el uso.
 *  - "Invitá a tu equipo" aparece sólo para quien administra una organización.
 */
export class OnboardingService {
  constructor(
    private readonly users: IUserRepository,
    private readonly preferences: OnboardingPreferences,
    private readonly analyses: IContentAnalysisRepository,
    private readonly invitations: IOrganizationInvitationRepository,
    private readonly authz: IAuthorizationService,
    private readonly clock: IClock,
  ) {}

  async status(userId: string): Promise<OnboardingStatus> {
    const user = await this.user(userId);
    const saved = user.onboarding ?? { done: [], skipped: [] };
    const derived: Partial<Record<OnboardingStepId, boolean>> = {
      topics: (await this.preferences.followedTopics(user)).length > 0,
      chat: user.channels.some((c) => c.verified && (c.channel === "whatsapp" || c.channel === "telegram")),
      notifications: saved.done.includes("notifications"),
      first_analysis: (await this.analyses.findByUser(user.id, 1)).length > 0,
    };
    if (await this.isOrgAdmin(user)) derived.team = await this.hasTeam(user.organizationId!);
    const steps = (Object.keys(derived) as OnboardingStepId[]).map((id) => ({ id, done: !!derived[id], skipped: !derived[id] && saved.skipped.includes(id) }));
    const pending = steps.filter((s) => !s.done && !s.skipped).length;
    return { steps, pending, dismissed: !!saved.dismissedAt || pending === 0 };
  }

  /** Marcar un paso como hecho (sólo los que no se deducen solos) o salteado. */
  async mark(userId: string, step: string, how: "done" | "skipped"): Promise<OnboardingStatus> {
    if (!STEPS.includes(step as OnboardingStepId)) throw new ValidationError("Paso desconocido.");
    if (how === "done" && step !== "notifications") throw new ValidationError("Ese paso se marca solo cuando está hecho.");
    const user = await this.user(userId);
    const saved = user.onboarding ?? { done: [], skipped: [] };
    const list = new Set(saved[how]);
    list.add(step);
    await this.users.save({ ...user, onboarding: { ...saved, [how]: [...list] } });
    return this.status(userId);
  }

  async dismiss(userId: string): Promise<OnboardingStatus> {
    const user = await this.user(userId);
    await this.users.save({ ...user, onboarding: { ...(user.onboarding ?? { done: [], skipped: [] }), dismissedAt: this.clock.now() } });
    return this.status(userId);
  }

  private async isOrgAdmin(user: User): Promise<boolean> {
    return !!user.organizationId && (await this.authz.permissionsOf(user)).has("users:manage_org");
  }

  private async hasTeam(orgId: string): Promise<boolean> {
    return (await this.users.findByOrganization(orgId)).length > 1 || (await this.invitations.findPending(orgId)).length > 0;
  }

  private async user(id: string): Promise<User> {
    const u = await this.users.findById(id);
    if (!u) throw new NotFoundError("Usuario inexistente.");
    return u;
  }
}

const STEPS: OnboardingStepId[] = ["topics", "chat", "notifications", "first_analysis", "team"];

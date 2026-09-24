import { randomBytes } from "node:crypto";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import { learningLevel, SMOKE_LABELS, type Classroom, type LearningState, type QuizItem, type SmokeType, type User } from "../../domain/model";
import type { IAuthorizationService, IClock, IDomainEvents, IIdGenerator, ILearningRepository, IUserRepository } from "../../domain/ports";
import type { AccessControl } from "../access/AccessControl";

export interface QuizQuestion {
  itemId: string;
  text: string;
  question: string;
}

export interface QuizResult {
  correct: boolean;
  wasSmoke: boolean;
  explanation: string;
  streak: number;
  score: { answered: number; correct: number; level: string };
}

/** Apodos: sin mails, teléfonos, links ni datos que identifiquen (hay menores). */
const ALIAS_RE = /^[\p{L}][\p{L}\p{N} _-]{1,19}$/u;
const looksPersonal = (s: string) => /\d{5,}|@|https?:|www\./i.test(s);

/**
 * MODO APRENDIZAJE ("¿esto es humo?").
 * REGLAS:
 *  - Cualquiera puede jugar; las AULAS son de organizaciones con `learning_mode` (plan Educación)
 *    y las crea un docente (`learning:teach`).
 *  - En un aula sólo se guarda un apodo. El docente ve apodos y aciertos, nunca datos de contacto.
 *  - Ranking apagado por defecto; si el docente lo prende, muestra apodos y nada más.
 *  - Las preguntas no se repiten hasta agotar el banco; primero las fáciles.
 */
export class LearningService {
  constructor(
    private readonly repo: ILearningRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
    private readonly events: IDomainEvents,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly tips: { byType: Record<SmokeType, string>; clean: string },
  ) {}

  async next(playerId: string): Promise<QuizQuestion> {
    const items = await this.repo.findItems();
    if (!items.length) throw new ValidationError("Todavía no hay preguntas cargadas.");
    const state = (await this.repo.getState(playerId)) ?? { playerId, answered: 0, correct: 0, streak: 0, bestStreak: 0 };
    const seen = new Map<string, number>();
    for (const a of await this.repo.findAttempts({ playerId })) seen.set(a.itemId, (seen.get(a.itemId) ?? 0) + 1);
    // Menos vistas primero; a igualdad, dificultad según cómo viene jugando.
    const target = state.answered < 5 ? 1 : state.correct / Math.max(1, state.answered) > 0.8 ? 3 : 2;
    const item = [...items].sort((a, b) => (seen.get(a.id) ?? 0) - (seen.get(b.id) ?? 0) || Math.abs(a.difficulty - target) - Math.abs(b.difficulty - target) || a.id.localeCompare(b.id))[0]!;
    const membership = (await this.repo.findMemberships(playerId))[0];
    await this.repo.saveState({ ...state, pendingItemId: item.id, askedAt: this.clock.now(), classroomId: membership?.classroomId });
    return { itemId: item.id, text: item.text, question: "¿Esto es humo? Respondé HUMO o LIMPIO." };
  }

  async hasPending(playerId: string): Promise<boolean> {
    return !!(await this.repo.getState(playerId))?.pendingItemId;
  }

  async answer(playerId: string, isSmoke: boolean): Promise<QuizResult> {
    const state = await this.repo.getState(playerId);
    if (!state?.pendingItemId) throw new ValidationError("No hay una pregunta pendiente. Escribí /jugar para empezar.");
    const item = (await this.repo.findItems()).find((i) => i.id === state.pendingItemId);
    if (!item) throw new NotFoundError("La pregunta ya no existe. Escribí /jugar.");
    const correct = item.isSmoke === isSmoke;
    await this.repo.addAttempt({ id: this.ids.next("attempt"), playerId, classroomId: state.classroomId, itemId: item.id, answeredSmoke: isSmoke, correct, at: this.clock.now() });
    const streak = correct ? state.streak + 1 : 0;
    const next: LearningState = {
      ...state, pendingItemId: undefined, askedAt: undefined, answered: state.answered + 1,
      correct: state.correct + (correct ? 1 : 0), streak, bestStreak: Math.max(state.bestStreak, streak),
    };
    await this.repo.saveState(next);
    return { correct, wasSmoke: item.isSmoke, explanation: item.explanation, streak, score: { answered: next.answered, correct: next.correct, level: learningLevel(next) } };
  }

  async progress(playerId: string) {
    const s = (await this.repo.getState(playerId)) ?? { playerId, answered: 0, correct: 0, streak: 0, bestStreak: 0 };
    return { answered: s.answered, correct: s.correct, bestStreak: s.bestStreak, level: learningLevel(s) };
  }

  async createClassroom(input: { teacherId: string; name: string; showLeaderboard?: boolean }): Promise<Classroom> {
    const teacher = await this.teacher(input.teacherId);
    const name = input.name.trim().slice(0, 60);
    if (!name) throw new ValidationError("Falta el nombre del aula.");
    let joinCode = "";
    for (let i = 0; i < 10 && !joinCode; i++) {
      const c = randomBytes(3).toString("hex").toUpperCase();
      if (!(await this.repo.findClassroomByCode(c))) joinCode = c;
    }
    const c: Classroom = {
      id: this.ids.next("aula"), organizationId: teacher.organizationId!, name, teacherId: teacher.id, joinCode,
      showLeaderboard: input.showLeaderboard ?? false, active: true, createdAt: this.clock.now(),
    };
    await this.repo.saveClassroom(c);
    await this.events.emit("learning.classroom_created", { userId: teacher.id, organizationId: teacher.organizationId }, { classroomId: c.id });
    return c;
  }

  async join(input: { userId: string; code: string; alias: string }): Promise<Classroom> {
    const c = await this.repo.findClassroomByCode(input.code.trim());
    if (!c?.active) throw new NotFoundError("No existe un aula con ese código.");
    const alias = input.alias.trim();
    if (!ALIAS_RE.test(alias) || looksPersonal(alias)) throw new ValidationError("Elegí un apodo de 2 a 20 letras (sin tu nombre completo, teléfono ni mail).");
    const others = await this.repo.findMembers(c.id);
    if (others.some((m) => m.alias.toLowerCase() === alias.toLowerCase() && m.userId !== input.userId)) throw new ConflictError("Ese apodo ya está en uso en el aula.");
    if (others.some((m) => m.userId === input.userId)) throw new ConflictError("Ya estás en esta aula.");
    await this.repo.addMember({ id: `${c.id}|${input.userId}`, classroomId: c.id, userId: input.userId, alias, joinedAt: this.clock.now() });
    return c;
  }

  /** Informe del docente: apodos, aciertos y los tipos de humo que más cuestan. */
  async report(input: { teacherId: string; classroomId: string }) {
    const c = await this.repo.findClassroom(input.classroomId);
    if (!c || c.teacherId !== input.teacherId) throw new NotFoundError("No existe esa aula.");
    const members = await this.repo.findMembers(c.id);
    const attempts = await this.repo.findAttempts({ classroomId: c.id });
    const items = new Map((await this.repo.findItems()).map((i) => [i.id, i]));
    const students = members.map((m) => {
      const mine = attempts.filter((a) => a.playerId === m.userId);
      const ok = mine.filter((a) => a.correct).length;
      return { alias: m.alias, answered: mine.length, correct: ok, accuracy: mine.length ? Math.round((ok / mine.length) * 100) / 100 : null };
    });
    const missesByType = new Map<string, number>();
    for (const a of attempts.filter((x) => !x.correct)) for (const t of items.get(a.itemId)?.types ?? ["(sin humo)"]) missesByType.set(t, (missesByType.get(t) ?? 0) + 1);
    return {
      classroom: { name: c.name, joinCode: c.joinCode, students: members.length },
      students: students.sort((a, b) => a.alias.localeCompare(b.alias)),
      hardest: [...missesByType.entries()].sort((a, b) => b[1] - a[1]).map(([type, misses]) => ({ type: SMOKE_LABELS[type as SmokeType] ?? type, misses })),
      leaderboard: c.showLeaderboard ? [...students].filter((s) => s.answered >= 3).sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0)).slice(0, 10).map((s) => s.alias) : undefined,
    };
  }

  /** Arma la explicación de un ejemplo a partir de sus tipos de humo. */
  explain(isSmoke: boolean, types: SmokeType[]): string {
    if (!isSmoke) return this.tips.clean;
    return types.map((t) => `${SMOKE_LABELS[t]}: ${this.tips.byType[t]}`).join(" ");
  }

  private async teacher(id: string): Promise<User> {
    const u = await this.users.findById(id);
    if (!u?.organizationId || !(await this.authz.permissionsOf(u)).has("learning:teach")) throw new AccessDeniedError("Sólo docentes de una escuela registrada crean aulas.", "no_permission");
    const { plan } = await this.access.planOf(u);
    if (!plan.features.includes("learning_mode")) throw new AccessDeniedError(`Las aulas no están incluidas en el plan ${plan.name}.`, "feature_not_in_plan");
    return u;
  }
}

/** Banco de preguntas inicial (idempotente) a partir de ejemplos etiquetados. */
export async function seedQuizItems(repo: ILearningRepository, examples: { text: string; isSmoke: boolean; types: SmokeType[] }[], explain: (isSmoke: boolean, types: SmokeType[]) => string): Promise<void> {
  const have = new Set((await repo.findItems()).map((i) => i.id));
  for (const [i, e] of examples.entries()) {
    const id = `q_${String(i + 1).padStart(3, "0")}`;
    if (have.has(id)) continue;
    const item: QuizItem = { id, text: e.text, isSmoke: e.isSmoke, types: e.types, explanation: explain(e.isSmoke, e.types), difficulty: e.types.length > 1 || !e.isSmoke ? 2 : 1, source: "evaluation_set" };
    await repo.saveItem(item);
  }
}

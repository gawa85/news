import type { SmokeType } from "./smoke";

/**
 * MODO APRENDIZAJE: "¿esto es humo?" como juego, para escuelas y para cualquiera.
 * Cuidado con menores: en un aula sólo se guarda un APODO (nunca nombre real, teléfono ni mail),
 * el docente no ve datos de contacto, no hay mensajes entre estudiantes y el ranking
 * está apagado por defecto.
 */
export interface QuizItem {
  id: string;
  text: string;
  isSmoke: boolean;
  types: SmokeType[];
  /** Explicación para después de responder (qué mirar la próxima vez). */
  explanation: string;
  difficulty: 1 | 2 | 3;
  source: "curated" | "evaluation_set";
}

export interface Classroom {
  id: string;
  organizationId: string;
  name: string;
  teacherId: string;
  joinCode: string;
  showLeaderboard: boolean;
  active: boolean;
  createdAt: Date;
}

export interface ClassroomMember {
  id: string; // `${classroomId}|${userId}`
  classroomId: string;
  userId: string;
  /** Apodo elegido (lo único que ve el docente). */
  alias: string;
  joinedAt: Date;
}

export interface QuizAttempt {
  id: string;
  playerId: string;
  classroomId?: string;
  itemId: string;
  answeredSmoke: boolean;
  correct: boolean;
  at: Date;
}

export interface LearningState {
  playerId: string;
  /** Pregunta pendiente de responder. */
  pendingItemId?: string;
  askedAt?: Date;
  classroomId?: string;
  answered: number;
  correct: number;
  streak: number;
  bestStreak: number;
}

export const learningLevel = (s: Pick<LearningState, "answered" | "correct">) =>
  s.answered < 5 ? "Principiante" : s.correct / s.answered >= 0.9 ? "Detector experto" : s.correct / s.answered >= 0.7 ? "Buen ojo" : "Aprendiendo";

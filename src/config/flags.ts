import type { FlagDefinition } from "../domain/model";

/** Funciones en prueba conocidas por el código (se prenden y apagan sin desplegar). */
export const FEATURE_FLAGS: FlagDefinition[] = [
  { key: "audio_replies", description: "Respuestas en audio (texto a voz).", defaultEnabled: true, defaultRollout: 100 },
  { key: "voice_notes", description: "Entender notas de voz (audio a texto).", defaultEnabled: true, defaultRollout: 100 },
  { key: "screenshots", description: "Leer capturas de pantalla (OCR).", defaultEnabled: true, defaultRollout: 100 },
  { key: "media_check", description: "Revisar fotos y videos: si ya circularon y qué dicen sus datos.", defaultEnabled: true, defaultRollout: 100 },
  { key: "digest", description: "Resumen diario o semanal.", defaultEnabled: true, defaultRollout: 100 },
  { key: "social_links", description: "Leer publicaciones de redes cuando se reenvía un link.", defaultEnabled: true, defaultRollout: 100 },
  { key: "event_rooms", description: "Eventos públicos en vivo (salas abiertas y chequeos por chat).", defaultEnabled: true, defaultRollout: 100 },
  { key: "learning_mode", description: "Modo aprendizaje (/jugar) para todas las personas.", defaultEnabled: true, defaultRollout: 100 },
  { key: "referrals", description: "Programa de invitaciones.", defaultEnabled: true, defaultRollout: 100 },
];

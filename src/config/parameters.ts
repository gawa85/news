import type { ParameterDefinition } from "../domain/model";

/**
 * PARÁMETROS DE NEGOCIO editables (con auditoría y motivo obligatorio).
 * El valor por defecto vive acá; el valor vigente, en la base.
 */
export const PARAMETERS: ParameterDefinition[] = [
  { key: "smoke.threshold", description: "Índice desde el cual un texto se considera 'con humo' (estadísticas y evaluación).", type: "number", default: 30, min: 5, max: 95, unit: "puntos (0-100)" },
  { key: "quality.promote_tolerance", description: "Cuánto puede empeorar F1/exactitud una versión nueva del algoritmo y aun así activarse.", type: "number", default: 0.02, min: 0, max: 0.1 },
  { key: "feedback.window_hours", description: "Horas en que un 'SÍ'/'NO' se asocia al último análisis.", type: "number", default: 24, min: 1, max: 168, unit: "horas" },
  { key: "reports.max_recipients", description: "Destinatarios máximos de un reporte programado.", type: "number", default: 10, min: 1, max: 50 },
  { key: "chat.show_feedback_question", description: "Mostrar '¿Te sirvió?' al pie de cada análisis.", type: "boolean", default: true },
  { key: "referrals.window_days", description: "Días desde el alta en que se puede usar un código de invitación.", type: "number", default: 14, min: 1, max: 90, unit: "días" },
  { key: "referrals.welcome_percent", description: "Descuento de bienvenida (primer pago) para quien llega invitado.", type: "number", default: 20, min: 0, max: 100, unit: "%" },
  { key: "referrals.max_rewards_per_year", description: "Premios máximos por año para quien invita.", type: "number", default: 12, min: 0, max: 100 },
  { key: "voice.max_seconds", description: "Duración máxima de una nota de voz que se transcribe (más larga, se pide el texto).", type: "number", default: 180, min: 10, max: 900, unit: "segundos" },
  { key: "evidence.max_mb", description: "Tamaño máximo de una página que se archiva.", type: "number", default: 10, min: 1, max: 50, unit: "MB" },
  { key: "evidence.monitor_days", description: "Días que se vuelve a mirar una nota archivada con seguimiento.", type: "number", default: 30, min: 1, max: 365, unit: "días" },
  { key: "evidence.recheck_hours", description: "Cada cuántas horas se vuelve a mirar una nota en seguimiento.", type: "number", default: 24, min: 1, max: 168, unit: "horas" },
  { key: "evidence.max_per_day", description: "Copias de notas por persona por día.", type: "number", default: 50, min: 1, max: 1000 },
  { key: "digest.hour", description: "Hora local a la que sale el resumen.", type: "number", default: 8, min: 0, max: 23, unit: "hora" },
  { key: "digest.weekday", description: "Día del resumen semanal (1 = lunes … 7 = domingo).", type: "number", default: 1, min: 1, max: 7 },
  { key: "digest.send_empty", description: "Mandar el resumen aunque no haya novedades.", type: "boolean", default: false },
  { key: "support.first_response_hours_default", description: "Horas para la primera respuesta de soporte (planes sin prioridad).", type: "number", default: 48, min: 1, max: 240, unit: "horas" },
];

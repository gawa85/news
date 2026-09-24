import type { SmokeType } from "../domain/model";

/**
 * SET DE EVALUACIÓN INICIAL (semilla): textos etiquetados a mano.
 * Sirve de piso: el equipo agrega más ejemplos (y los que llegan por "no me sirvió", ya revisados).
 * Mezcla textos CON humo y SIN humo para medir tanto lo que encuentra como lo que inventa.
 */
export const SEED_EVALUATION_SET: { text: string; isSmoke: boolean; types: SmokeType[] }[] = [
  // --- Con humo ---
  { text: "¡URGENTE! Reenviá esto a todos tus contactos antes de que lo borren. Mañana cortan el agua en todo el país.", isSmoke: true, types: ["chain_call", "alarmism"] },
  { text: "Es un logro histórico, sin precedentes, el mejor plan de la historia que va a cambiar todo para siempre.", isSmoke: true, types: ["inflated_adjective"] },
  { text: "Vamos a trabajar para que en el futuro todos tengan más oportunidades y un país mejor.", isSmoke: true, types: ["vague_promise"] },
  { text: "Según dicen los expertos, el 90% de la gente ya dejó de comprar carne. Todos lo saben.", isSmoke: true, types: ["unsourced_claim"] },
  { text: "Alerta máxima: catástrofe inminente, se viene el colapso total del sistema de salud.", isSmoke: true, types: ["alarmism"] },
  { text: "La solución revolucionaria e increíble que los bancos no quieren que conozcas. Oferta exclusiva por tiempo limitado.", isSmoke: true, types: ["marketing", "inflated_adjective"] },
  { text: "En este sentido, cabe destacar que, de alguna manera, es importante mencionar que la situación es la que es.", isSmoke: true, types: ["filler"] },
  { text: "Compartí este mensaje: la vacuna tiene un chip, lo confirmó un médico que prefiere no dar su nombre.", isSmoke: true, types: ["chain_call", "unsourced_claim"] },
  { text: "Un gobierno espectacular, extraordinario, que hizo la obra más impresionante de la década.", isSmoke: true, types: ["inflated_adjective"] },
  { text: "Nos comprometemos a seguir trabajando incansablemente para lograr un futuro mejor para todos los argentinos.", isSmoke: true, types: ["vague_promise"] },
  { text: "Pasalo a tus grupos de WhatsApp: desde el lunes el dólar va a valer el triple, fuentes seguras lo confirman.", isSmoke: true, types: ["chain_call", "unsourced_claim"] },
  // --- Sin humo ---
  { text: "El INDEC informó que la inflación de agosto fue de 2,1% mensual, según el informe publicado el 12 de septiembre.", isSmoke: false, types: [] },
  { text: "El Ente Regulador del Gas fijó un aumento del 4% en la tarifa residencial a partir del 1 de octubre (Resolución 512/2026).", isSmoke: false, types: [] },
  { text: "La reunión de la comisión de presupuesto se pasó al martes 30 a las 10 horas en el Salón Azul.", isSmoke: false, types: [] },
  { text: "El hospital municipal atiende guardias de 8 a 20 horas; fuera de ese horario se deriva al hospital provincial.", isSmoke: false, types: [] },
  { text: "La paritaria docente cerró con un aumento de 12% en tres cuotas: 5% en octubre, 4% en noviembre y 3% en diciembre.", isSmoke: false, types: [] },
  { text: "El Banco Central informó reservas por 31.200 millones de dólares al cierre del viernes, según su serie diaria.", isSmoke: false, types: [] },
  { text: "Te paso el informe del trimestre: las ventas subieron 3% respecto del mismo período del año pasado.", isSmoke: false, types: [] },
  { text: "El municipio cortará el tránsito en la avenida San Martín entre 1 y 7 el sábado de 9 a 13 por obras de cloacas.", isSmoke: false, types: [] },
  { text: "La encuesta de la universidad, con 1.200 casos y un margen de error de 2,8 puntos, ubica a los dos candidatos en empate técnico.", isSmoke: false, types: [] },
];

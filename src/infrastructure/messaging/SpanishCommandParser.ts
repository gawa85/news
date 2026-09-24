import type { Command } from "../../domain/model";
import type { ICommandParser } from "../../domain/ports";

const URL_RE = /https?:\/\/[^\s)>\]]+/g;

/**
 * Interpreta mensajes en español. Todo lo que no es un comando se analiza como contenido
 * (lo más común: el usuario reenvía una cadena o pega una nota).
 * Se puede reemplazar por un intérprete con IA que entienda lenguaje natural.
 */
export class SpanishCommandParser implements ICommandParser {
  parse(text: string): Command {
    const t = text.trim();
    const [head = "", ...restParts] = t.split(/\s+/);
    const cmd = head.toLowerCase().replace(/^\//, "");
    const rest = restParts.join(" ").trim();
    const isCommand = head.startsWith("/");

    if (["ayuda", "hola", "start", "menu", "menú"].includes(cmd) && (isCommand || restParts.length === 0)) return { type: "help" };
    if (!isCommand) return { type: "analyze_content", text: t };

    switch (cmd) {
      case "comparar": {
        const includeUrls = rest.match(URL_RE) ?? [];
        const month = rest.match(/\b(20\d{2}-(0[1-9]|1[0-2]))\b/)?.[1];
        const topic = rest.replace(URL_RE, "").replace(month ?? "\u0000", "").replace(/\s+/g, " ").trim();
        return topic ? { type: "compare_sources", topic, month, includeUrls } : { type: "help" };
      }
      case "credibilidad": {
        const [outlet, topic] = rest.split("|").map((s) => s.trim());
        return outlet && topic ? { type: "credibility", outlet, topic } : { type: "help" };
      }
      case "excluir":
        return rest ? { type: "exclude_site", pattern: rest.split(/\s+/)[0]! } : { type: "help" };
      case "reglas":
        return { type: "list_rules" };
      case "plan":
        return { type: "my_plan" };
      case "seguir":
        return rest ? { type: "follow_topic", topic: rest } : { type: "list_topics" };
      case "dejar":
        return rest ? { type: "unfollow_topic", topic: rest.replace(/^de seguir\s+/i, "") } : { type: "help" };
      case "temas":
        return { type: "list_topics" };
      case "formato": {
        const f = rest.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const format = f.startsWith("cort") ? "short" : f.startsWith("detall") ? "detailed" : f.startsWith("facil") || f.includes("lectura") ? "easy_read" : undefined;
        return format ? { type: "set_format", format } : { type: "my_preferences" };
      }
      case "silencio": {
        if (/^(no|off|sacar|quitar)$/i.test(rest)) return { type: "quiet_hours" };
        const m = rest.match(/^(\d{1,2})(?::(\d{2}))?\s*(?:-|a|hasta)\s*(\d{1,2})(?::(\d{2}))?$/i);
        if (!m) return { type: "my_preferences" };
        const hh = (h: string, mm?: string) => `${h.padStart(2, "0")}:${mm ?? "00"}`;
        return { type: "quiet_hours", from: hh(m[1]!, m[2]), to: hh(m[3]!, m[4]) };
      }
      case "preferencias":
        return { type: "my_preferences" };
      case "audio":
        return /^(no|off|sacar)$/i.test(rest) ? { type: "audio_replies", on: false } : { type: "audio_replies", on: true };
      case "jugar":
      case "juego":
        return { type: "quiz_next" };
      case "progreso":
        return { type: "quiz_progress" };
      case "aula": {
        const [code, ...alias] = rest.split(/\s+/);
        return code && alias.length ? { type: "join_classroom", code, alias: alias.join(" ") } : { type: "help" };
      }
      case "invitar":
        return { type: "invite" };
      case "codigo":
      case "código":
        return rest ? { type: "referral_code", code: rest.split(/\s+/)[0]! } : { type: "invite" };
      case "soporte":
      case "ayuda-humana":
        return rest ? { type: "support", text: rest } : { type: "support_list" };
      case "tickets":
        return { type: "support_list" };
      case "guardar":
      case "archivar":
        // "/guardar <link> seguir" → además la vuelve a mirar para detectar ediciones o borrados.
        return { type: "archive_url", url: rest.match(URL_RE)?.[0] ?? "", monitor: /\b(seguir|seguimiento|vigilar|monitorear)\b/i.test(rest) };
      case "humo":
      case "analizar":
        return rest ? { type: "analyze_content", text: rest } : { type: "help" };
      default:
        return { type: "help" };
    }
  }
}

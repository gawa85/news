/**
 * Proveedores de SEÑALES sobre la fuente de un contenido. Cada uno mira un aspecto
 * y se registran en una lista (OCP): sumar una señal = sumar una clase.
 */
import { urlMatches, type ContentItem, type SourceSignal } from "../../domain/model";
import type { IOutletReader, ISignalProvider } from "../../domain/ports";

/**
 * Autenticación del mail: SPF, DKIM y DMARC (del encabezado Authentication-Results
 * que agrega el servidor que recibió el mail) y Reply-To distinto del remitente.
 */
export class EmailAuthenticationSignals implements ISignalProvider {
  appliesTo(item: ContentItem) {
    return item.sourceType === "email";
  }

  async signals(item: ContentItem): Promise<SourceSignal[]> {
    const out: SourceSignal[] = [];
    const auth = (item.metadata["authentication-results"] ?? "").toLowerCase();
    const result = (mech: string) => auth.match(new RegExp(`${mech}=(\\w+)`))?.[1];

    if (!auth) {
      out.push({ id: "email_auth_unknown", level: "info", label: "Autenticación del remitente", detail: "El mail no trae resultados de SPF/DKIM/DMARC: no se puede confirmar quién lo envió." });
    } else {
      const spf = result("spf"), dkim = result("dkim"), dmarc = result("dmarc");
      const failed = [["SPF", spf], ["DKIM", dkim], ["DMARC", dmarc]].filter(([, r]) => r && r !== "pass" && r !== "none");
      out.push(
        failed.length
          ? { id: "email_auth_failed", level: "danger", label: "Remitente no verificado", detail: `Falló ${failed.map(([m, r]) => `${m} (${r})`).join(", ")}: el remitente podría estar falsificado.` }
          : { id: "email_auth_ok", level: "ok", label: "Remitente verificado", detail: `SPF: ${spf ?? "-"}, DKIM: ${dkim ?? "-"}, DMARC: ${dmarc ?? "-"}.` },
      );
    }

    const replyTo = item.metadata["reply-to"];
    const fromDomain = item.origin.domain;
    if (replyTo && fromDomain && !replyTo.toLowerCase().endsWith(`@${fromDomain}`)) {
      out.push({ id: "email_reply_to_mismatch", level: "warning", label: "Responder a otra dirección", detail: `Las respuestas van a ${replyTo}, que no es el dominio del remitente (${fromDomain}).` });
    }
    return out;
  }
}

/** Reenvíos: el contenido no es del remitente sino de otra persona. */
export class ForwardSignals implements ISignalProvider {
  appliesTo(item: ContentItem) {
    return !!item.forwardedFrom || item.metadata["forwarded-many-times"] === "true";
  }

  async signals(item: ContentItem): Promise<SourceSignal[]> {
    const out: SourceSignal[] = [];
    if (item.forwardedFrom) {
      const who = item.forwardedFrom.name ?? item.forwardedFrom.address;
      out.push({
        id: "forwarded",
        level: "info",
        label: "Contenido reenviado",
        detail: who
          ? `El texto original es de ${who}${item.forwardedFrom.date ? ` (${item.forwardedFrom.date})` : ""}, no de quien lo reenvió.`
          : "Es un reenvío: no se sabe quién lo escribió originalmente.",
      });
    }
    if (item.metadata["forwarded-many-times"] === "true") {
      out.push({ id: "forwarded_many", level: "warning", label: "Reenviado muchas veces", detail: "Circula en cadena: es habitual en desinformación. Buscá el origen." });
    }
    return out;
  }
}

const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "cutt.ly", "is.gd", "shorturl.at"];

/** Links: acortadores (ocultan el destino) y cuántos apuntan a medios conocidos. */
export class LinkSignals implements ISignalProvider {
  constructor(private readonly outlets: IOutletReader) {}

  appliesTo(item: ContentItem) {
    return item.urls.length > 0;
  }

  async signals(item: ContentItem): Promise<SourceSignal[]> {
    const out: SourceSignal[] = [];
    const shortened = item.urls.filter((u) => SHORTENERS.some((s) => urlMatches(u, s)));
    if (shortened.length) {
      out.push({ id: "link_shortener", level: "warning", label: "Links acortados", detail: `${shortened.length} link(s) ocultan su destino real (${shortened.slice(0, 3).join(", ")}).` });
    }
    const outlets = await this.outlets.findAll();
    const known = item.urls.filter((u) => outlets.some((o) => urlMatches(u, o.url)));
    if (item.urls.length && known.length === 0) {
      out.push({ id: "no_known_sources", level: "info", label: "Sin medios reconocidos", detail: "Ninguno de los links apunta a un medio registrado." });
    }
    return out;
  }
}

/** Si el ORIGEN (remitente, dominio del feed) es un medio registrado, lo dice. */
export class KnownOutletOriginSignal implements ISignalProvider {
  constructor(private readonly outlets: IOutletReader) {}

  appliesTo(item: ContentItem) {
    return !!item.origin.domain;
  }

  async signals(item: ContentItem): Promise<SourceSignal[]> {
    const outlet = (await this.outlets.findAll()).find((o) => urlMatches(`https://${item.origin.domain}`, o.url));
    return outlet
      ? [{ id: "known_outlet", level: "info", label: "Origen conocido", detail: `Proviene de ${outlet.name}. Podés consultar su credibilidad por tema.` }]
      : [];
  }
}

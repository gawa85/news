/**
 * SERVIDOR MCP (Model Context Protocol): expone Sin Humo como herramientas para
 * agentes de IA (Claude, otros asistentes, bots propios).
 *
 * Cada herramienta llama al MISMO ProductGateway que WhatsApp o la web: el agente
 * tiene exactamente los permisos de la clave de API con la que se conectó, el plan
 * de su dueño y sus cuotas. Las respuestas públicas que proponga un agente quedan
 * en revisión humana salvo que la clave tenga permiso de moderación.
 */
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AccessDeniedError, DomainError } from "../../domain/errors";
import type { ReplyTargetKind, ReviewTargetType } from "../../domain/model";
import type { IOutletReader } from "../../domain/ports";
import type { AccessControl } from "../../application/access/AccessControl";
import type { Caller, ProductGateway } from "../../application/access/ProductGateway";
import type { ResponseComposer } from "../../application/messaging/ResponseComposer";
import type { ReplyService } from "../../application/replies/ReplyService";
import type { ReviewService } from "../../application/reviews/ReviewService";
import { toMarkdown } from "../replies/Publishers";

export interface McpDeps {
  gateway: ProductGateway;
  access: AccessControl;
  composer: ResponseComposer;
  replies: ReplyService;
  reviews: ReviewService;
  outlets: IOutletReader;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(fn: () => Promise<{ markdown: string; data: unknown }>): Promise<ToolResult> {
  try {
    const { markdown, data } = await fn();
    return { content: [{ type: "text", text: markdown }, { type: "text", text: JSON.stringify(data) }] };
  } catch (err) {
    const msg = err instanceof AccessDeniedError
      ? `${err.message}${err.upgradeHint ? ` ${err.upgradeHint}` : ""}`
      : err instanceof DomainError ? err.message : "Error interno.";
    return { isError: true, content: [{ type: "text", text: msg }] };
  }
}

const day = (s: string, end = false) => new Date(`${s}T${end ? "23:59:59" : "00:00:00"}-03:00`);

export function buildMcpServer(deps: McpDeps, caller: Caller): McpServer {
  const server = new McpServer({ name: "sin-humo", version: "0.1.0" });
  const { gateway, composer } = deps;

  server.registerTool(
    "analizar_contenido",
    {
      title: "Analizar contenido",
      description: "Separa hechos de humo (adjetivos inflados, promesas vagas, rumores sin fuente, alarmismo) en un texto: mensaje, nota, mail o publicación. Devuelve índice de humo, hechos, versión limpia y señales sobre la fuente.",
      inputSchema: { texto: z.string().min(1).max(50_000), url_origen: z.string().url().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ texto, url_origen }) =>
      run(async () => {
        const now = new Date();
        const a = await gateway.analyzeContent(caller, {
          id: randomUUID(), sourceType: url_origen ? "web" : "message",
          origin: url_origen ? { address: url_origen, domain: new URL(url_origen).hostname } : {},
          text: texto, urls: texto.match(/https?:\/\/[^\s)]+/g) ?? [], publishedAt: now, receivedAt: now, attachments: [], metadata: {},
        });
        return { markdown: toMarkdown(composer.content(a)), data: { smokeIndex: a.smoke.smokeIndex, facts: a.smoke.facts, findings: a.smoke.findings, signals: a.signals } };
      }),
  );

  server.registerTool(
    "comparar_fuentes",
    {
      title: "Comparar fuentes",
      description: "Compara cómo cubren un tema distintas fuentes: en qué coinciden, en qué difieren (datos, interpretación o valores), qué omite cada una y qué falta verificar.",
      inputSchema: {
        tema: z.string().min(2),
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("AAAA-MM-DD"),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("AAAA-MM-DD"),
        incluir_urls: z.array(z.string().url()).max(20).optional(),
        excluir: z.array(z.string()).max(50).optional().describe("Dominios o secciones a excluir"),
        solo_de: z.array(z.string()).max(50).optional().describe("Limitar a estos dominios"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (a) =>
      run(async () => {
        const r = await gateway.compareSources(caller, {
          topic: a.tema,
          period: { from: day(a.desde), to: day(a.hasta, true) },
          urlRules: { include: a.incluir_urls, exclude: a.excluir, onlyFrom: a.solo_de },
        });
        return { markdown: toMarkdown(await composer.comparison(r)), data: { outlets: r.outletIds, agreements: r.agreements.map((c) => c.summary), disagreements: r.disagreements, openQuestions: r.openQuestions, urls: r.articleUrls } };
      }),
  );

  server.registerTool(
    "credibilidad_medio",
    {
      title: "Credibilidad de un medio",
      description: "Credibilidad de un medio en un tema y período, desglosada: exactitud verificada, calidad de fuentes, conflicto de interés de los dueños, dependencia de pauta oficial y coherencia ante cambios políticos.",
      inputSchema: { medio: z.string().describe("Id o nombre del medio"), tema: z.string(), desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) },
      annotations: { readOnlyHint: true },
    },
    (a) =>
      run(async () => {
        const all = await deps.outlets.findAll();
        const outlet = all.find((o) => o.id === a.medio || o.name.toLowerCase().includes(a.medio.toLowerCase()));
        if (!outlet) throw new DomainError(`No encontré el medio "${a.medio}".`);
        const r = await gateway.evaluateCredibility(caller, { outletId: outlet.id, topic: a.tema, period: { from: day(a.desde), to: day(a.hasta, true) } });
        return { markdown: toMarkdown(composer.credibility(r)), data: { overall: r.overall, dimensions: r.dimensions.map((d) => ({ id: d.dimensionId, score: d.score, confidence: d.confidence, summary: d.summary })) } };
      }),
  );

  server.registerTool(
    "mi_plan",
    { title: "Mi plan", description: "Plan, límites y consumo actual de la cuenta de esta clave.", inputSchema: {}, annotations: { readOnlyHint: true } },
    () =>
      run(async () => {
        const user = await deps.access.userOrThrow(caller.userId);
        const { plan } = await deps.access.planOf(user);
        const usage = await deps.access.usageOf(user);
        return { markdown: toMarkdown(composer.plan(plan, usage)), data: { plan: plan.id, limits: plan.limits, usage } };
      }),
  );

  server.registerTool(
    "calificar",
    {
      title: "Calificar",
      description: "Deja una calificación (1 a 5) y un comentario opcional sobre un análisis, una respuesta, un medio o la plataforma.",
      inputSchema: { tipo: z.enum(["analysis", "reply", "outlet", "platform"]), id: z.string(), estrellas: z.number().int().min(1).max(5), comentario: z.string().max(2000).optional() },
    },
    (a) =>
      run(async () => {
        const r = await deps.reviews.submit({ userId: caller.userId, target: { type: a.tipo as ReviewTargetType, id: a.id }, rating: a.estrellas, text: a.comentario });
        return { markdown: `Calificación registrada (${r.status === "published" ? "publicada" : "en revisión"}).`, data: { id: r.id, status: r.status } };
      }),
  );

  server.registerTool(
    "proponer_respuesta",
    {
      title: "Proponer una respuesta",
      description: "Propone responder en un hilo de mail, chat, foro o página. Las respuestas públicas (foros, páginas) deben citar fuentes y quedan en revisión humana salvo permiso de moderación.",
      inputSchema: {
        tipo: z.enum(["email_thread", "chat", "forum_thread", "web_page"]),
        destino: z.string().describe('Ej.: "email", "whatsapp", "discourse:foro.example", "wordpress:blog.example"'),
        ref: z.string().describe("Dirección, id del tema/post o URL de la página"),
        en_respuesta_a: z.string().optional(),
        tema: z.string().optional(),
        titulo: z.string().min(3).max(200),
        texto: z.string().min(10).max(5000),
        fuentes: z.array(z.object({ nombre: z.string(), url: z.string().url() })).max(10),
      },
    },
    (a) =>
      run(async () => {
        const draft = await deps.replies.request({
          actorId: caller.userId,
          target: { kind: a.tipo as ReplyTargetKind, destination: a.destino, ref: a.ref, inReplyTo: a.en_respuesta_a },
          content: { kind: "result", title: a.titulo, summary: a.texto, sections: [], links: a.fuentes.map((f) => ({ label: f.nombre, url: f.url })) },
          topic: a.tema,
        });
        const estado = { pending_review: "quedó en revisión", published: "publicada", failed: "falló", rejected: "rechazada" }[draft.status];
        return { markdown: `Respuesta ${estado}.${draft.publishedUrl ? ` ${draft.publishedUrl}` : ""}${draft.error ? ` (${draft.error})` : ""}`, data: { id: draft.id, status: draft.status, url: draft.publishedUrl } };
      }),
  );

  return server;
}

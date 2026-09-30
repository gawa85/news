import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import { withinLimit, type ContentAnalysis, type ContentSourceType, type SourceConnection } from "../../domain/model";
import type {
  IAuthorizationService,
  IClock,
  IContentSource,
  IIdGenerator,
  ILogger,
  IMimeParser,
  ISecretVault,
  ISourceConnectionRepository,
  IUserRepository,
} from "../../domain/ports";
import type { AccessControl } from "../access/AccessControl";
import type { ProductGateway } from "../access/ProductGateway";
import type { ResponseComposer } from "../messaging/ResponseComposer";
import type { ReplyService } from "../replies/ReplyService";
import type { RegisterUserUseCase } from "../users/RegisterUserUseCase";

/**
 * Conectar una fuente propia (buzón IMAP, feed RSS...).
 * REGLAS: permiso `sources:connect`, plan con `source_connections`, límite de conexiones,
 * se PRUEBA la conexión antes de guardarla, y la contraseña va a la bóveda cifrada.
 */
export class ConnectSourceUseCase {
  constructor(
    private readonly sources: IContentSource[],
    private readonly connections: ISourceConnectionRepository,
    private readonly vault: ISecretVault,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
  ) {}

  async execute(input: { actorId: string; type: ContentSourceType; name: string; config: Record<string, string>; secret?: string }): Promise<SourceConnection> {
    const actor = await this.access.userOrThrow(input.actorId);
    const perms = await this.authz.permissionsOf(actor);
    if (!perms.has("sources:connect")) throw new AccessDeniedError("Tu rol no permite conectar fuentes.", "no_permission");
    const { plan } = await this.access.planOf(actor);
    if (!plan.features.includes("source_connections")) throw new AccessDeniedError(`Conectar fuentes no está en el plan ${plan.name}.`, "feature_not_in_plan");
    const current = (await this.connections.findByUser(actor.id)).filter((c) => c.active).length;
    if (!withinLimit(plan.limits.maxSourceConnections, current + 1)) {
      throw new AccessDeniedError(`Tu plan permite ${plan.limits.maxSourceConnections} fuente(s) conectada(s).`, "limit_exceeded");
    }
    const source = this.sources.find((s) => s.type === input.type);
    if (!source) throw new ValidationError(`No hay integración para fuentes de tipo ${input.type}.`);

    const connection: SourceConnection = {
      id: this.ids.next("conn"),
      userId: actor.id,
      type: input.type,
      name: input.name,
      config: input.config,
      active: true,
      createdAt: this.clock.now(),
    };
    await source.test(connection, input.secret); // si falla, no se guarda nada
    if (input.secret) connection.secretRef = await this.vault.put(input.secret);
    await this.connections.save(connection);
    return connection;
  }
}

/**
 * Tarea periódica: lee lo nuevo de cada fuente conectada, lo analiza y avisa.
 * Cada conexión es independiente: si una falla, las demás siguen.
 */
const MANUAL_COOLDOWN_MS = 60_000;

export interface SyncResult {
  connectionId: string;
  /** Notas o mails nuevos que se analizaron. */
  analyzed: number;
  /** Cuántos de esos tenían humo. */
  withSmoke: number;
  error?: string;
}

export class SyncSourcesUseCase {
  constructor(
    private readonly sources: IContentSource[],
    private readonly connections: ISourceConnectionRepository,
    private readonly vault: ISecretVault,
    private readonly gateway: ProductGateway,
    private readonly clock: IClock,
    private readonly logger: ILogger,
  ) {}

  /** Lo corre la cola cada 15 minutos: todas las fuentes activas. */
  async execute(): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    for (const conn of await this.connections.findActive()) results.push(await this.syncOne(conn));
    return results;
  }

  /**
   * "Leer ahora" desde la web: una fuente de la persona, en el momento. Como mucho una vez por
   * minuto por fuente (cuenta también si falló): no se castiga al sitio ni al buzón.
   */
  async syncNow(input: { actorId: string; connectionId: string }): Promise<SyncResult> {
    const conn = await this.connections.findById(input.connectionId);
    if (!conn || conn.userId !== input.actorId || !conn.active) throw new NotFoundError("No existe esa fuente.");
    const last = Math.max(conn.lastSyncAt?.getTime() ?? 0, conn.lastError?.at.getTime() ?? 0);
    if (this.clock.now().getTime() - last < MANUAL_COOLDOWN_MS) throw new ConflictError("Se leyó hace menos de un minuto. Probá de nuevo en un rato.");
    return this.syncOne(conn);
  }

  private async syncOne(conn: SourceConnection): Promise<SyncResult> {
    try {
      const source = this.sources.find((s) => s.type === conn.type);
      if (!source) throw new Error(`Sin integración para ${conn.type}`);
      const secret = conn.secretRef ? await this.vault.get(conn.secretRef) : undefined;
      const { items, cursor } = await source.pull(conn, secret);
      let analyzed = 0;
      let withSmoke = 0;
      for (const item of items) {
        try {
          const a = await this.gateway.analyzeContent({ userId: conn.userId, channel: "web" }, { ...item, connectionId: conn.id });
          analyzed++;
          if (a.smoke.findings.length > 0) withSmoke++;
        } catch (err) {
          // Una nota sin texto (sólo título o video) no frena a las demás; el cupo o el plan, sí.
          if (!(err instanceof ValidationError)) throw err;
        }
      }
      await this.connections.save({ ...conn, cursor: cursor ?? conn.cursor, lastSyncAt: this.clock.now(), lastError: undefined });
      return { connectionId: conn.id, analyzed, withSmoke };
    } catch (err) {
      this.logger.warn("Falló la sincronización de una fuente", { connectionId: conn.id, error: String(err) });
      const message = err instanceof Error ? err.message : String(err);
      await this.connections.save({ ...conn, lastError: { at: this.clock.now(), message: message.slice(0, 300) } }).catch(() => undefined);
      return { connectionId: conn.id, analyzed: 0, withSmoke: 0, error: message };
    }
  }
}

/**
 * Mail recibido por SMTP (el usuario reenvía un mail a analizar@…).
 *
 * REGLAS:
 *  - El remitente se identifica por su mail VERIFICADO. Si no existe y el mail pasó
 *    SPF/DKIM (el servidor que lo recibió lo certifica), se registra en el plan gratuito.
 *  - Si el remitente no está autenticado, NO se responde: responder a remitentes
 *    falsificados manda mails a terceros que no los pidieron (backscatter).
 *  - La respuesta va en el MISMO HILO (In-Reply-To / References).
 */
export class ReceiveEmailUseCase {
  constructor(
    private readonly parser: IMimeParser,
    private readonly users: IUserRepository,
    private readonly register: RegisterUserUseCase,
    private readonly gateway: ProductGateway,
    private readonly composer: ResponseComposer,
    private readonly replies: ReplyService,
    private readonly logger: ILogger,
  ) {}

  async execute(raw: Buffer | string): Promise<{ status: "answered" | "ignored"; reason?: string; analysis?: ContentAnalysis }> {
    const item = await this.parser.parse(raw);
    const sender = item.metadata["envelope-from"] || item.metadata["from-address"];
    if (!sender) return { status: "ignored", reason: "sin remitente" };
    const authenticated = item.metadata["sender-authenticated"] === "true";

    let user = await this.users.findByChannel("email", sender);
    if (!user) {
      if (!authenticated) {
        this.logger.warn("Mail de remitente no autenticado: se ignora", { sender });
        return { status: "ignored", reason: "remitente no autenticado" };
      }
      user = await this.register.execute({ name: item.metadata["from-name"] || sender, channel: { type: "email", address: sender, verified: true } });
    }

    // Se analiza lo reenviado: si es un reenvío, el "origen" es el autor original.
    let analysis: ContentAnalysis | undefined;
    let response;
    try {
      analysis = await this.gateway.analyzeContent({ userId: user.id, channel: "email" }, item);
      response = this.composer.content(analysis);
    } catch (err) {
      response = this.composer.error(err);
    }

    const messageId = item.metadata["message-id"];
    await this.replies.request({
      actorId: user.id,
      target: {
        kind: "email_thread",
        destination: "email",
        ref: sender,
        inReplyTo: messageId,
        subject: item.title ? `Re: ${item.title.replace(/^(re|rv|fwd?|reenviado):\s*/i, "")}` : "Tu análisis",
        channel: "email",
      },
      content: response,
    });
    return { status: "answered", analysis };
  }
}

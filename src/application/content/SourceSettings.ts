import { NotFoundError } from "../../domain/errors";
import type { SourceConnection } from "../../domain/model";
import type { IAuthorizationService, ISourceConnectionRepository } from "../../domain/ports";
import type { AccessControl } from "../access/AccessControl";

/** Lo que se muestra de una fuente: nunca la referencia a la contraseña. */
export type PublicConnection = Omit<SourceConnection, "secretRef" | "userId" | "cursor">;

/**
 * MIS FUENTES: ver las conectadas (y si están andando) y desconectarlas.
 * (Conectar es ConnectSourceUseCase: ahí están el permiso, el plan, el límite y la prueba.)
 */
export class SourceSettings {
  constructor(
    private readonly connections: ISourceConnectionRepository,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
  ) {}

  async list(actorId: string): Promise<{ available: boolean; limit: number | null; connections: PublicConnection[] }> {
    const actor = await this.access.userOrThrow(actorId);
    const { plan } = await this.access.planOf(actor);
    const available = plan.features.includes("source_connections") && (await this.authz.permissionsOf(actor)).has("sources:connect");
    const connections = (await this.connections.findByUser(actor.id))
      .filter((c) => c.active)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(({ secretRef: _s, userId: _u, cursor: _c, ...c }) => c);
    return { available, limit: plan.limits.maxSourceConnections, connections };
  }

  /** Desconectar: deja de leerse. (La contraseña queda en la bóveda sin uso hasta que se borren los datos.) */
  async disconnect(input: { actorId: string; connectionId: string }): Promise<void> {
    const c = await this.connections.findById(input.connectionId);
    if (!c || c.userId !== input.actorId || !c.active) throw new NotFoundError("No existe esa fuente.");
    await this.connections.save({ ...c, active: false });
  }
}

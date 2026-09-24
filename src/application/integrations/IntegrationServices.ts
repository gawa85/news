import { createHash, randomBytes } from "node:crypto";
import { AccessDeniedError, ValidationError } from "../../domain/errors";
import { PERMISSIONS, WEBHOOK_EVENTS, type ApiKey, type Permission, type WebhookEventType, type WebhookSubscription } from "../../domain/model";
import type {
  IApiKeyRepository,
  IAuthorizationService,
  IClock,
  IDomainEvents,
  IIdGenerator,
  ISecretVault,
  IUserRepository,
  IWebhookRepository,
} from "../../domain/ports";
import type { AccessControl } from "../access/AccessControl";
import type { Caller } from "../access/ProductGateway";

export const hashApiKey = (plaintext: string) => createHash("sha256").update(plaintext).digest("hex");

/**
 * Claves de API para bots, agentes de IA y clientes MCP.
 * REGLAS:
 *  - Crear claves requiere el permiso `api_keys:manage` y un plan con `api_access`.
 *  - Los alcances de una clave nunca superan los permisos del rol de su dueño.
 *  - Se guarda sólo el hash; la clave se muestra una vez.
 *  - Una clave de un usuario suspendido o revocada no funciona.
 */
export class ApiKeyService {
  constructor(
    private readonly keys: IApiKeyRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly events: IDomainEvents,
  ) {}

  async create(input: { actorId: string; name: string; scopes: Permission[] }): Promise<{ plaintext: string; key: ApiKey }> {
    const actor = await this.access.userOrThrow(input.actorId);
    const perms = await this.authz.permissionsOf(actor);
    if (!perms.has("api_keys:manage")) throw new AccessDeniedError("Tu rol no permite crear claves de API.", "no_permission");
    const { plan } = await this.access.planOf(actor);
    if (!plan.features.includes("api_access")) throw new AccessDeniedError(`El acceso por API no está en el plan ${plan.name}.`, "feature_not_in_plan");
    const unknown = input.scopes.filter((s) => !(PERMISSIONS as readonly string[]).includes(s));
    if (unknown.length) throw new ValidationError(`Alcances desconocidos: ${unknown.join(", ")}`);
    const excess = input.scopes.filter((s) => !perms.has(s));
    if (excess.length) throw new AccessDeniedError(`No podés darle a la clave permisos que no tenés: ${excess.join(", ")}.`, "no_permission");

    const plaintext = `sh_live_${randomBytes(24).toString("base64url")}`;
    const key: ApiKey = {
      id: this.ids.next("key"),
      prefix: plaintext.slice(0, 12),
      hash: hashApiKey(plaintext),
      userId: actor.id,
      name: input.name,
      scopes: input.scopes,
      revoked: false,
      createdAt: this.clock.now(),
    };
    await this.keys.save(key);
    await this.events.emit("api_key.created", { userId: actor.id, organizationId: actor.organizationId }, { name: key.name, prefix: key.prefix, scopes: key.scopes }, { type: "api_key", id: key.id });
    return { plaintext, key };
  }

  /** Valida una clave y devuelve quién llama (canal "api" + alcances). */
  async authenticate(plaintext: string | undefined): Promise<Caller> {
    if (!plaintext) throw new AccessDeniedError("Falta la clave de API.", "no_permission");
    const key = await this.keys.findByHash(hashApiKey(plaintext.trim()));
    if (!key || key.revoked) throw new AccessDeniedError("Clave de API inválida o revocada.", "no_permission");
    const user = await this.users.findById(key.userId);
    if (!user || user.status !== "active") throw new AccessDeniedError("La cuenta de esta clave no está activa.", "user_inactive");
    await this.keys.save({ ...key, lastUsedAt: this.clock.now() });
    return { userId: user.id, channel: "api", scopes: new Set(key.scopes) };
  }

  async revoke(input: { actorId: string; keyId: string }): Promise<void> {
    const key = (await this.keys.findByUser(input.actorId)).find((k) => k.id === input.keyId);
    if (!key) throw new ValidationError("No existe esa clave.");
    await this.keys.save({ ...key, revoked: true });
    await this.events.emit("api_key.revoked", { userId: input.actorId }, { prefix: key.prefix }, { type: "api_key", id: key.id });
  }
}

/**
 * Webhooks salientes: avisos a sistemas externos cuando pasan cosas.
 * REGLAS: permiso `webhooks:manage` + plan con `webhooks`; sólo URLs https
 * (salvo localhost para desarrollo); el secreto de firma se muestra una vez.
 */
export class WebhookService {
  constructor(
    private readonly webhooks: IWebhookRepository,
    private readonly vault: ISecretVault,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly events: IDomainEvents,
  ) {}

  async register(input: { actorId: string; url: string; events: WebhookEventType[] }): Promise<{ subscription: WebhookSubscription; signingSecret: string }> {
    const actor = await this.access.userOrThrow(input.actorId);
    const perms = await this.authz.permissionsOf(actor);
    if (!perms.has("webhooks:manage")) throw new AccessDeniedError("Tu rol no permite configurar webhooks.", "no_permission");
    const { plan } = await this.access.planOf(actor);
    if (!plan.features.includes("webhooks")) throw new AccessDeniedError(`Los webhooks no están en el plan ${plan.name}.`, "feature_not_in_plan");

    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new ValidationError("URL inválida.");
    }
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !local) throw new ValidationError("El webhook tiene que usar https.");
    const bad = input.events.filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
    if (bad.length || !input.events.length) throw new ValidationError(`Eventos inválidos: ${bad.join(", ") || "(ninguno)"}`);

    const signingSecret = `whsec_${randomBytes(24).toString("base64url")}`;
    const subscription: WebhookSubscription = {
      id: this.ids.next("wh"),
      userId: actor.id,
      url: input.url,
      events: input.events,
      secretRef: await this.vault.put(signingSecret),
      active: true,
      createdAt: this.clock.now(),
    };
    await this.webhooks.save(subscription);
    await this.events.emit("webhook.registered", { userId: actor.id, organizationId: actor.organizationId }, { url: subscription.url, events: subscription.events }, { type: "webhook", id: subscription.id });
    return { subscription, signingSecret };
  }
}

import { AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import {
  CHANNEL_TYPES,
  HHMM,
  categoryAndDescendants,
  resolvePreferences,
  SYSTEM_PREFERENCES,
  type EffectivePreferences,
  type OrgPreferenceDefaults,
  type PreferenceKey,
  type PreferenceValues,
  type Topic,
  type User,
} from "../../domain/model";
import type {
  IAuthorizationService,
  IClock,
  IDomainEvents,
  IPreferencesReader,
  IPreferencesRepository,
  ITaxonomyRepository,
  ITopicResolver,
  IUserRepository,
} from "../../domain/ports";

const FORMATS = ["short", "detailed", "easy_read"] as const;
const DIGESTS = ["off", "daily", "weekly"] as const;
const LANGUAGES = ["es"]; // se amplía con la internacionalización (grupo 3)

/**
 * PREFERENCIAS de cada persona y valores por defecto de la organización.
 * REGLAS:
 *  - Cada uno cambia las suyas; los valores por defecto de la organización, quien tiene `users:manage_org`.
 *  - Lo que la organización BLOQUEA no lo puede cambiar el miembro.
 *  - Los temas se aceptan por nombre, id o sinónimo y se guardan como id de la taxonomía.
 *  - Canales para avisos: sólo los verificados de la persona.
 *  - Horario de silencio: "HH:MM" a "HH:MM" (puede cruzar la medianoche).
 */
export class PreferencesService implements IPreferencesReader {
  constructor(
    private readonly repo: IPreferencesRepository,
    private readonly taxonomy: ITaxonomyRepository,
    private readonly resolver: ITopicResolver,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
  ) {}

  async effective(user: User): Promise<EffectivePreferences> {
    const [mine, org] = await Promise.all([this.repo.findUser(user.id), user.organizationId ? this.repo.findOrg(user.organizationId) : undefined]);
    return resolvePreferences(mine, org);
  }

  async update(input: { actorId: string; values: Partial<PreferenceValues> }): Promise<EffectivePreferences> {
    const user = await this.user(input.actorId);
    const org = user.organizationId ? await this.repo.findOrg(user.organizationId) : undefined;
    const locked = Object.keys(input.values).filter((k) => org?.locked.includes(k as PreferenceKey));
    if (locked.length) throw new AccessDeniedError(`Tu organización fijó: ${locked.join(", ")}. Pedile el cambio a quien la administra.`, "no_permission");
    const values = await this.validate(input.values, user);
    const current = await this.repo.findUser(user.id);
    await this.repo.saveUser({ userId: user.id, values: { ...current?.values, ...values }, updatedAt: this.clock.now() });
    return this.effective(user);
  }

  async follow(actorId: string, text: string): Promise<Topic> {
    const topic = await this.topicOrThrow(text);
    const eff = await this.effective(await this.user(actorId));
    if (!eff.followedTopics.includes(topic.id)) await this.update({ actorId, values: { followedTopics: [...eff.followedTopics, topic.id] } });
    return topic;
  }

  async unfollow(actorId: string, text: string): Promise<Topic> {
    const topic = await this.topicOrThrow(text);
    const eff = await this.effective(await this.user(actorId));
    await this.update({ actorId, values: { followedTopics: eff.followedTopics.filter((t) => t !== topic.id) } });
    return topic;
  }

  async setOrgDefaults(input: { actorId: string; values: Partial<PreferenceValues>; locked?: PreferenceKey[] }): Promise<OrgPreferenceDefaults> {
    const actor = await this.user(input.actorId);
    if (!actor.organizationId) throw new ValidationError("No pertenecés a ninguna organización.");
    if (!(await this.authz.permissionsOf(actor)).has("users:manage_org")) throw new AccessDeniedError("Sólo quien administra la organización fija sus preferencias.", "no_permission");
    const locked = [...new Set(input.locked ?? [])];
    const unknown = locked.filter((k) => !(k in SYSTEM_PREFERENCES));
    if (unknown.length) throw new ValidationError(`Preferencias desconocidas: ${unknown.join(", ")}.`);
    if (locked.includes("notifyChannels") || input.values.notifyChannels) throw new ValidationError("Los canales de aviso son personales (dependen de los canales verificados de cada uno).");
    const d: OrgPreferenceDefaults = {
      organizationId: actor.organizationId, values: await this.validate(input.values), locked, updatedAt: this.clock.now(), updatedBy: actor.id,
    };
    await this.repo.saveOrg(d);
    await this.events.emit("preferences.org_changed", { userId: actor.id, organizationId: actor.organizationId }, { keys: Object.keys(d.values), locked });
    return d;
  }

  /** ¿La persona silenció la categoría de este tema (o una categoría que la contiene)? */
  async isMuted(user: User, topicText: string): Promise<boolean> {
    const eff = await this.effective(user);
    if (!eff.mutedCategories.length) return false;
    const topic = await this.resolver.resolve(topicText);
    if (!topic) return false;
    const cats = await this.taxonomy.findCategories();
    return eff.mutedCategories.some((m) => categoryAndDescendants(m, cats).has(topic.categoryId));
  }

  /** Personas que siguen el tema (por preferencias). */
  async followers(topicText: string): Promise<string[]> {
    const topic = await this.resolver.resolve(topicText);
    return topic ? (await this.repo.findFollowers(topic.id)).map((p) => p.userId) : [];
  }

  private async validate(v: Partial<PreferenceValues>, user?: User): Promise<Partial<PreferenceValues>> {
    const out: Partial<PreferenceValues> = {};
    for (const k of Object.keys(v)) if (!(k in SYSTEM_PREFERENCES)) throw new ValidationError(`Preferencia desconocida: ${k}.`);
    if (v.followedTopics) {
      if (v.followedTopics.length > 50) throw new ValidationError("Podés seguir hasta 50 temas.");
      out.followedTopics = [];
      for (const t of v.followedTopics) out.followedTopics.push((await this.topicOrThrow(t)).id);
      out.followedTopics = [...new Set(out.followedTopics)];
    }
    if (v.mutedCategories) {
      const cats = new Set((await this.taxonomy.findCategories()).filter((c) => c.active).map((c) => c.id));
      const bad = v.mutedCategories.filter((c) => !cats.has(c));
      if (bad.length) throw new ValidationError(`Categorías desconocidas: ${bad.join(", ")}.`);
      out.mutedCategories = [...new Set(v.mutedCategories)];
    }
    if (v.responseFormat !== undefined) {
      if (!FORMATS.includes(v.responseFormat)) throw new ValidationError("Formato: short (corto), detailed (detallado) o easy_read (lectura fácil).");
      out.responseFormat = v.responseFormat;
    }
    if (v.digest !== undefined) {
      if (!DIGESTS.includes(v.digest)) throw new ValidationError("Resumen: off, daily o weekly.");
      out.digest = v.digest;
    }
    if (v.language !== undefined) {
      if (!LANGUAGES.includes(v.language)) throw new ValidationError(`Idiomas disponibles: ${LANGUAGES.join(", ")}.`);
      out.language = v.language;
    }
    if (v.quietHours !== undefined) {
      const q = v.quietHours;
      if (q && (!HHMM.test(q.from) || !HHMM.test(q.to) || q.from === q.to)) throw new ValidationError('Horario de silencio: "HH:MM" a "HH:MM", distintos.');
      out.quietHours = q ? { from: q.from, to: q.to, utcOffsetMinutes: q.utcOffsetMinutes ?? -180 } : null;
    }
    if (v.audioReplies !== undefined) {
      if (typeof v.audioReplies !== "boolean") throw new ValidationError("audioReplies es sí o no.");
      out.audioReplies = v.audioReplies;
    }
    if (v.notifyChannels) {
      const bad = v.notifyChannels.filter((c) => !CHANNEL_TYPES.includes(c));
      if (bad.length) throw new ValidationError(`Canales desconocidos: ${bad.join(", ")}.`);
      if (user) {
        const verified = new Set(user.channels.filter((c) => c.verified).map((c) => c.channel));
        const missing = v.notifyChannels.filter((c) => !verified.has(c));
        if (missing.length) throw new ValidationError(`Primero verificá estos canales: ${missing.join(", ")}.`);
      }
      out.notifyChannels = [...new Set(v.notifyChannels)];
    }
    return out;
  }

  private async topicOrThrow(text: string): Promise<Topic> {
    const t = await this.resolver.resolve(text);
    if (!t) throw new NotFoundError(`No conozco el tema "${text}". Escribí /temas para ver la lista.`);
    return t;
  }

  private async user(id: string): Promise<User> {
    const u = await this.users.findById(id);
    if (!u || u.status !== "active") throw new NotFoundError("Usuario inexistente.");
    return u;
  }
}

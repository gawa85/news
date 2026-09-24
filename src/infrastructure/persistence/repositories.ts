/**
 * TODOS los repositorios del sistema, escritos UNA sola vez sobre IDocumentCollection.
 * Funcionan igual en memoria, SQLite o PostgreSQL.
 */
import { randomUUID } from "node:crypto";
import { ConflictError } from "../../domain/errors";
import type {
  AlertRule,
  Article,
  BillingSubject,
  ChannelType,
  Claim,
  ClaimVerdict,
  ContentAnalysis,
  Organization,
  Outlet,
  Plan,
  Role,
  SavedRuleSet,
  SourceConnection,
  Subscription,
  UsageEvent,
  UsageMetric,
  User,
} from "../../domain/model";
import type { ArticleFilter, Repositories, SecretRecord, VerificationCodeRecord } from "../../domain/ports";
import type { ICollectionFactory, IDocumentCollection, Query } from "./collection";
import { schemas, subjectKeyOf, type ChannelLink, type MediaRecord, type UsageRow } from "./schemas";

const linkId = (channel: ChannelType, address: string) => `${channel}:${address.trim().toLowerCase()}`;

class UserRepository {
  constructor(
    private readonly users: IDocumentCollection<User>,
    private readonly links: IDocumentCollection<ChannelLink>,
  ) {}

  findById(id: string) {
    return this.users.get(id);
  }

  async findByChannel(channel: ChannelType, address: string) {
    const link = await this.links.get(linkId(channel, address));
    return link ? this.users.get(link.userId) : undefined;
  }

  findByOrganization(organizationId: string) {
    return this.users.find({ where: { organizationId } });
  }

  save(user: User) {
    return this.users.upsert(user);
  }

  releaseChannels(userId: string) {
    return this.links.deleteWhere({ where: { userId } });
  }

  async claimChannel(userId: string, channel: ChannelType, address: string) {
    const id = linkId(channel, address);
    try {
      await this.links.insert({ id, userId });
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
      const existing = await this.links.get(id);
      if (existing?.userId !== userId) throw new ConflictError("Esa dirección ya está vinculada a otra cuenta.");
    }
  }
}

export function buildRepositories(f: ICollectionFactory): Repositories {
  const outlets = f.collection(schemas.outlets);
  const articles = f.collection(schemas.articles);
  const claims = f.collection(schemas.claims);
  const verdicts = f.collection(schemas.verdicts);
  const roles = f.collection(schemas.roles);
  const orgs = f.collection(schemas.organizations);
  const plans = f.collection(schemas.plans);
  const subs = f.collection(schemas.subscriptions);
  const usage = f.collection(schemas.usage);
  const ruleSets = f.collection(schemas.ruleSets);
  const alerts = f.collection(schemas.alerts);
  const analyses = f.collection(schemas.contentAnalyses);
  const connections = f.collection(schemas.sourceConnections);
  const secrets = f.collection(schemas.secrets);
  const codes = f.collection(schemas.verificationCodes);
  const drafts = f.collection(schemas.replyDrafts);
  const apiKeys = f.collection(schemas.apiKeys);
  const webhooks = f.collection(schemas.webhooks);
  const reviews = f.collection(schemas.reviews);
  const impact = f.collection(schemas.impact);
  const links = f.collection(schemas.trackedLinks);
  const deliveries = f.collection(schemas.deliveryLog);
  const health = f.collection(schemas.destinationHealth);
  const optOuts = f.collection(schemas.optOuts);
  const windows = f.collection(schemas.conversationWindows);
  const audit = f.collection(schemas.audit);
  const sessions = f.collection(schemas.sessions);
  const creds = f.collection(schemas.credentials);
  const magic = f.collection(schemas.magicLinks);
  const oauth = f.collection(schemas.oauthStates);
  const attempts = f.collection(schemas.loginAttempts);
  const rebuttals = f.collection(schemas.rebuttals);
  const corrections = f.collection(schemas.corrections);
  const jobs = f.collection(schemas.jobs);
  const vtasks = f.collection(schemas.verificationTasks);
  const odocs = f.collection(schemas.officialDocuments);
  const bprofiles = f.collection(schemas.billingProfiles);
  const invoices = f.collection(schemas.invoices);
  const costs = f.collection(schemas.costs);
  const narratives = f.collection(schemas.narratives);
  const campaigns = f.collection(schemas.campaigns);
  const allies = f.collection(schemas.campaignAllies);
  const cdeliveries = f.collection(schemas.campaignDeliveries);
  const perspectives = f.collection(schemas.perspectives);
  const pvotes = f.collection(schemas.perspectiveVotes);
  const rooms = f.collection(schemas.rooms);
  const rmessages = f.collection(schemas.roomMessages);
  const owners = f.collection(schemas.owners);
  const ownership = f.collection(schemas.ownership);
  const advertising = f.collection(schemas.advertising);
  const feeds = f.collection(schemas.feeds);
  const examples = f.collection(schemas.examples);
  const versions = f.collection(schemas.modelVersions);
  const runs = f.collection(schemas.evaluationRuns);
  const feedback = f.collection(schemas.feedback);
  const counters = f.collection(schemas.statCounters);
  const contributors = f.collection(schemas.statContributors);
  const schedules = f.collection(schemas.reportSchedules);
  const categories = f.collection(schemas.categories);
  const topics = f.collection(schemas.topics);
  const userPrefs = f.collection(schemas.userPreferences);
  const orgPrefs = f.collection(schemas.orgPreferences);
  const follows = f.collection(schemas.topicFollows);
  const bizRules = f.collection(schemas.businessRules);
  const params = f.collection(schemas.parameters);
  const coupons = f.collection(schemas.coupons);
  const redemptions = f.collection(schemas.couponRedemptions);
  const refCodes = f.collection(schemas.referralCodes);
  const refUses = f.collection(schemas.referralUses);
  const brandings = f.collection(schemas.branding);
  const quizItems = f.collection(schemas.quizItems);
  const classrooms = f.collection(schemas.classrooms);
  const members = f.collection(schemas.classroomMembers);
  const quizAttempts = f.collection(schemas.quizAttempts);
  const lstates = f.collection(schemas.learningStates);
  const tickets = f.collection(schemas.tickets);
  const flags = f.collection(schemas.featureFlags);
  const media = f.collection(schemas.media);
  const consents = f.collection(schemas.consents);
  const evidence = f.collection(schemas.evidence);
  const evidenceBlobs = f.collection(schemas.evidenceBlobs);
  const digests = f.collection(schemas.digestDeliveries);
  const latestBy = <T extends { version: number }>(items: T[], key: (x: T) => string) => {
    const m = new Map<string, T>();
    for (const x of items) if ((m.get(key(x))?.version ?? -1) < x.version) m.set(key(x), x);
    return [...m.values()];
  };
  const addrKey = (channel: string, address: string) => `${channel}:${address.trim().toLowerCase()}`;

  return {
    outlets: {
      findById: (id) => outlets.get(id),
      findAll: () => outlets.find(),
      save: (o: Outlet) => outlets.upsert(o),
    },
    articles: {
      findById: (id) => articles.get(id),
      find: (flt: ArticleFilter) => {
        const where: Query["where"] = {};
        if (flt.topic) where.topic = flt.topic;
        if (flt.outletId) where.outletId = flt.outletId;
        if (flt.period) where.publishedAt = { gte: flt.period.from, lte: flt.period.to };
        return articles.find({ where, orderBy: { field: "publishedAt", direction: "asc" } });
      },
      saveMany: async (items: Article[]) => {
        for (const a of items) await articles.upsert(a);
      },
    },
    claims: {
      findByArticleIds: (ids) => claims.find({ where: { articleId: { in: ids } } }),
      saveMany: async (items: Claim[]) => {
        // Reprocesar un artículo reemplaza sus afirmaciones (no duplica).
        await claims.deleteWhere({ where: { articleId: { in: [...new Set(items.map((c) => c.articleId))] } } });
        for (const c of items) await claims.upsert(c);
      },
    },
    verdicts: {
      findByClaimIds: (ids) => verdicts.find({ where: { claimId: { in: ids } } }),
      save: (v: ClaimVerdict) => verdicts.upsert(v),
    },
    users: new UserRepository(f.collection(schemas.users), f.collection(schemas.channelLinks)),
    roles: {
      findByIds: (ids) => roles.find({ where: { id: { in: ids } } }),
      findAll: () => roles.find(),
      save: (r: Role) => roles.upsert(r),
    },
    organizations: {
      findById: (id) => orgs.get(id),
      save: (o: Organization) => orgs.upsert(o),
    },
    plans: {
      findById: (id) => plans.get(id),
      findAll: () => plans.find({ orderBy: { field: "tier", direction: "asc" } }),
      save: (p: Plan) => plans.upsert(p),
    },
    subscriptions: {
      findById: (id) => subs.get(id),
      findCurrent: async (subject: BillingSubject) =>
        (await subs.find({ where: { subject: subjectKeyOf(subject), status: { in: ["trialing", "active", "past_due", "canceled"] } }, orderBy: { field: "createdAt", direction: "desc" }, limit: 1 }))[0],
      save: (s: Subscription) => subs.upsert(s),
      findAll: () => subs.find({ orderBy: { field: "createdAt", direction: "asc" } }),
    },
    usage: {
      count: (subjectId: string, metric: UsageMetric, since: Date) =>
        usage.count({ where: { subjectId, metric, at: { gte: since } } }),
      record: (e: UsageEvent) => usage.upsert({ ...e, id: randomUUID() } satisfies UsageRow),
    },
    ruleSets: {
      findActiveFor: (owners: BillingSubject[]) =>
        ruleSets.find({ where: { owner: { in: owners.map(subjectKeyOf) }, active: true } }),
      countFor: (owner: BillingSubject) => ruleSets.count({ where: { owner: subjectKeyOf(owner) } }),
      findByOwner: (owner: BillingSubject) => ruleSets.find({ where: { owner: subjectKeyOf(owner) } }),
      save: (r: SavedRuleSet) => ruleSets.upsert(r),
      deleteByOwner: (owner: BillingSubject) => ruleSets.deleteWhere({ where: { owner: subjectKeyOf(owner) } }),
    },
    alerts: {
      findByUser: (userId) => alerts.find({ where: { userId } }),
      findActiveByTopic: (topic) => alerts.find({ where: { topic, active: true } }),
      countActiveByUser: (userId) => alerts.count({ where: { userId, active: true } }),
      findAllActive: () => alerts.find({ where: { active: true } }),
      save: (a: AlertRule) => alerts.upsert(a),
      deleteByUser: (userId) => alerts.deleteWhere({ where: { userId } }),
    },
    contentAnalyses: {
      save: (a: ContentAnalysis) => analyses.upsert(a),
      findById: (id) => analyses.get(id),
      findByUser: (userId, limit) => analyses.find({ where: { userId }, orderBy: { field: "analyzedAt", direction: "desc" }, limit }),
      findByUsersSince: (userIds, since, limit) =>
        userIds.length ? analyses.find({ where: { userId: { in: userIds }, analyzedAt: { gte: since } }, orderBy: { field: "analyzedAt", direction: "asc" }, limit }) : Promise.resolve([]),
      deleteByUser: (userId) => analyses.deleteWhere({ where: { userId } }),
      deleteOlderThan: (date) => analyses.deleteWhere({ where: { analyzedAt: { lte: date } } }),
    },
    sourceConnections: {
      findById: (id) => connections.get(id),
      findByUser: (userId) => connections.find({ where: { userId } }),
      findActive: () => connections.find({ where: { active: true } }),
      save: (c: SourceConnection) => connections.upsert(c),
      deleteByUser: (userId) => connections.deleteWhere({ where: { userId } }),
    },
    secrets: {
      get: (ref) => secrets.get(ref),
      save: (r: SecretRecord) => secrets.upsert(r),
      delete: (ref) => secrets.deleteWhere({ where: { id: ref } }),
    },
    verificationCodes: {
      get: (key) => codes.get(key),
      save: (r: VerificationCodeRecord) => codes.upsert(r),
      delete: (key) => codes.deleteWhere({ where: { id: key } }),
    },
    replyDrafts: {
      findById: (id) => drafts.get(id),
      findByStatus: (status, limit) => drafts.find({ where: { status }, orderBy: { field: "createdAt", direction: "asc" }, limit }),
      findPublishedBetween: (from, to) => drafts.find({ where: { status: "published", publishedAt: { gte: from, lte: to } } }),
      save: (d) => drafts.upsert(d),
    },
    apiKeys: {
      findByHash: async (hash) => (await apiKeys.find({ where: { hash }, limit: 1 }))[0],
      findByUser: (userId) => apiKeys.find({ where: { userId } }),
      save: (k) => apiKeys.upsert(k),
    },
    webhooks: {
      findActiveForEvent: async (userId, event) =>
        (await webhooks.find({ where: { userId, active: true } })).filter((w) => (w.events as string[]).includes(event)),
      findByUser: (userId) => webhooks.find({ where: { userId } }),
      save: (w) => webhooks.upsert(w),
    },
    reviews: {
      findById: (id) => reviews.get(id),
      findByTarget: (t, status) =>
        reviews.find({ where: { target: `${t.type}:${t.id}`, ...(status ? { status } : {}) } }),
      findByAuthor: (userId) => reviews.find({ where: { author: userId } }),
      save: (r) => reviews.upsert(r),
      deleteByAuthor: (userId) => reviews.deleteWhere({ where: { author: userId } }),
    },
    impact: {
      save: (snap) => impact.upsert(snap),
      latestFor: async (replyIds) => {
        const all = await impact.find({ where: { replyId: { in: replyIds } }, orderBy: { field: "collectedAt", direction: "desc" } });
        const seen = new Set<string>();
        return all.filter((x) => !seen.has(x.replyId) && seen.add(x.replyId));
      },
    },
    trackedLinks: {
      findByCode: (code) => links.get(code),
      findByReply: (replyId) => links.find({ where: { replyId } }),
      save: (l) => links.upsert(l),
    },
    deliveryLog: {
      record: (a) => deliveries.upsert(a),
      countSent: (destination, since, recipientHash) =>
        deliveries.count({ where: { destination, outcome: "sent", at: { gte: since }, ...(recipientHash ? { recipientHash } : {}) } }),
      lastSent: async (destination, recipientHash) =>
        (await deliveries.find({ where: { destination, recipientHash, outcome: "sent" }, orderBy: { field: "at", direction: "desc" }, limit: 1 }))[0]?.at,
      deleteOlderThan: (date) => deliveries.deleteWhere({ where: { at: { lte: date } } }),
    },
    destinationHealth: {
      get: (destination) => health.get(destination),
      save: (h) => health.upsert(h),
    },
    optOuts: {
      isOptedOut: async (channel, address) => !!(await optOuts.get(addrKey(channel, address))),
      save: (o) => optOuts.upsert(o),
      remove: (channel, address) => optOuts.deleteWhere({ where: { id: addrKey(channel, address) } }),
    },
    conversationWindows: {
      touch: (channel, address, at) => windows.upsert({ id: addrKey(channel, address), lastInboundAt: at }),
      lastInbound: async (channel, address) => (await windows.get(addrKey(channel, address)))?.lastInboundAt,
    },
    audit: {
      record: (e) => audit.insert(e), // inmutable: nunca se reescribe una entrada
      find: (flt) => {
        const where: Query["where"] = {};
        if (flt.organizationId) where.organizationId = flt.organizationId;
        if (flt.actorId) where.actorId = flt.actorId;
        if (flt.action) where.action = flt.action;
        if (flt.from || flt.to) where.at = { ...(flt.from ? { gte: flt.from } : {}), ...(flt.to ? { lte: flt.to } : {}) };
        return audit.find({ where, orderBy: { field: "at", direction: "desc" }, limit: flt.limit ?? 200 });
      },
    },
    sessions: {
      findById: (id) => sessions.get(id),
      findByUser: (userId) => sessions.find({ where: { userId } }),
      save: (s) => sessions.upsert(s),
    },
    credentials: {
      findByEmail: (email) => creds.get(email.trim().toLowerCase()),
      save: (c) => creds.upsert({ ...c, email: c.email.trim().toLowerCase() }),
      deleteByUser: (userId) => creds.deleteWhere({ where: { userId } }),
    },
    magicLinks: {
      findById: (id) => magic.get(id),
      save: (m) => magic.upsert(m),
    },
    oauthStates: {
      take: async (state) => {
        const s = await oauth.get(state);
        if (s) await oauth.deleteWhere({ where: { id: state } }); // un solo uso
        return s;
      },
      save: (s) => oauth.upsert(s),
    },
    loginAttempts: {
      countFailures: (identifierHash, since) => attempts.count({ where: { identifierHash, ok: false, at: { gte: since } } }),
      record: (a) => attempts.upsert(a),
      deleteOlderThan: (date) => attempts.deleteWhere({ where: { at: { lte: date } } }),
    },
    rebuttals: {
      findById: (id) => rebuttals.get(id),
      findByOutlet: (outletId) => rebuttals.find({ where: { outletId }, orderBy: { field: "createdAt", direction: "desc" } }),
      findPending: (limit) => rebuttals.find({ where: { status: "submitted" }, orderBy: { field: "createdAt", direction: "asc" }, limit }),
      save: (r) => rebuttals.upsert(r),
    },
    corrections: {
      findRecent: (limit) => corrections.find({ orderBy: { field: "publishedAt", direction: "desc" }, limit }),
      findByOutlet: (outletId) => corrections.find({ where: { outletId }, orderBy: { field: "publishedAt", direction: "desc" } }),
      save: (c) => corrections.upsert(c),
    },
    jobs: {
      insert: (j) => jobs.insert(j),
      findById: (id) => jobs.get(id),
      findDue: (now, limit) => jobs.find({ where: { status: "queued", runAt: { lte: now } }, orderBy: { field: "runAt", direction: "asc" }, limit }),
      findExpiredLeases: (now, limit) => jobs.find({ where: { status: "running", lockedUntil: { lte: now } }, limit }),
      replaceIf: (j, expected) => jobs.updateIf(j, { status: expected.status, ...(expected.lockedBy !== undefined ? { lockedBy: expected.lockedBy } : {}) }),
      countByStatus: (status) => jobs.count({ where: { status } }),
      deleteFinishedBefore: (date) => jobs.deleteWhere({ where: { status: "done", finishedAt: { lte: date } } }),
    },
    verificationTasks: {
      findById: (id) => vtasks.get(id),
      findByStatus: (status, limit) => vtasks.find({ where: { status }, orderBy: { field: "priority", direction: "desc" }, limit }),
      insert: (t) => vtasks.insert(t),
      save: (t) => vtasks.upsert(t),
    },
    officialDocuments: {
      // Pocos documentos por tema: se filtra en memoria por tema (índice por fecha).
      findByTopic: async (topic) => (await odocs.find({ orderBy: { field: "publishedAt", direction: "desc" }, limit: 500 })).filter((d) => d.topics.includes(topic)),
      save: (d) => odocs.upsert(d),
    },
    billingProfiles: {
      find: (subject) => bprofiles.get(subjectKeyOf(subject)),
      save: (b) => bprofiles.upsert(b),
    },
    invoices: {
      findById: (id) => invoices.get(id),
      findBySubject: (subject) => invoices.find({ where: { subject: subjectKeyOf(subject) }, orderBy: { field: "issueDate", direction: "desc" } }),
      save: (i) => invoices.upsert(i),
    },
    costs: {
      record: (c) => costs.upsert(c),
      findBetween: (from, to) => costs.find({ where: { at: { gte: from, lte: to } } }),
    },
    narratives: {
      findById: (id) => narratives.get(id),
      findActiveSince: (date) => narratives.find({ where: { lastSeenAt: { gte: date } } }),
      findTop: (since, limit) => narratives.find({ where: { lastSeenAt: { gte: since } }, orderBy: { field: "occurrences", direction: "desc" }, limit }),
      save: (n) => narratives.upsert(n),
    },
    campaigns: {
      findById: (id) => campaigns.get(id),
      findByStatus: (status) => campaigns.find({ where: { status } }),
      save: (c) => campaigns.upsert(c),
      findAllies: (campaignId) => allies.find({ where: { campaignId } }),
      saveAlly: (a) => allies.upsert(a),
      recordDelivery: (d) => cdeliveries.upsert(d),
      findDeliveries: (campaignId) => cdeliveries.find({ where: { campaignId } }),
    },
    perspectives: {
      findById: (id) => perspectives.get(id),
      findByTarget: (t) => perspectives.find({ where: { target: `${t.type}:${t.id}` } }),
      save: (p) => perspectives.upsert(p),
      vote: async (v) => {
        const prev = await pvotes.get(v.id);
        await pvotes.upsert(v);
        return prev;
      },
    },
    rooms: {
      findById: (id) => rooms.get(id),
      findByOrganization: (orgId) => rooms.find({ where: { organizationId: orgId } }),
      save: (r) => rooms.upsert(r),
      addMessage: (m) => rmessages.insert(m),
      saveMessage: (m) => rmessages.upsert(m),
      findMessage: (id) => rmessages.get(id),
      history: async (roomId, limit) => (await rmessages.find({ where: { roomId }, orderBy: { field: "at", direction: "desc" }, limit })).reverse(),
      lastMessageBy: async (roomId: string, userId: string) => (await rmessages.find({ where: { roomId, authorId: userId }, orderBy: { field: "at", direction: "desc" }, limit: 1 }))[0],
    },
    catalog: {
      findOwners: (ids) => (ids ? owners.find({ where: { id: { in: ids } } }) : owners.find()),
      saveOwner: (o) => owners.upsert(o),
      findOwnership: (outletId) => ownership.find({ where: { outletId } }),
      saveOwnership: (r) => ownership.upsert(r),
      // Se solapa con el período: empieza antes de que termine y termina después de que empiece.
      findAdvertising: (outletId, p) => advertising.find({ where: { outletId, from: { lte: p.to }, to: { gte: p.from } } }),
      saveAdvertising: (a) => advertising.upsert(a),
      findActiveFeeds: () => feeds.find({ where: { active: true } }),
      saveFeed: (f) => feeds.upsert(f),
    },
    quality: {
      findExamples: () => examples.find(),
      saveExample: (e) => examples.upsert(e),
      findVersion: (id) => versions.get(id),
      findVersions: () => versions.find(),
      saveVersion: (v) => versions.upsert(v),
      saveRun: (r) => runs.upsert(r),
      findRuns: (modelVersion) => runs.find({ where: { modelVersion }, orderBy: { field: "at", direction: "desc" } }),
      saveFeedback: (f) => feedback.upsert(f),
      findFeedback: (since) => feedback.find({ where: { at: { gte: since } } }),
    },
    stats: {
      increment: async (k, by = 1) => {
        const id = [k.day, k.scope, k.scopeId, k.metric, k.dim ?? ""].join("|");
        // Control optimista: si otro servidor sumó en el medio, se reintenta con el valor nuevo.
        for (let attempt = 0; attempt < 20; attempt++) {
          const cur = await counters.get(id);
          if (!cur) {
            try {
              await counters.insert({ id, day: k.day, scope: k.scope, scopeId: k.scopeId, metric: k.metric, dim: k.dim ?? "", value: by, rev: 1 });
              return by;
            } catch (e) {
              if (e instanceof ConflictError) continue;
              throw e;
            }
          }
          const next = { ...cur, value: cur.value + by, rev: cur.rev + 1 };
          if (await counters.updateIf(next, { rev: cur.rev })) return next.value;
        }
        throw new ConflictError("No se pudo actualizar el contador (demasiada concurrencia).");
      },
      find: (q) =>
        counters.find({ where: { series: `${q.scope}:${q.scopeId}`, day: { gte: q.fromDay, lte: q.toDay }, ...(q.metrics ? { metric: { in: q.metrics } } : {}) } }),
      addContributor: async (group, pseudonym) => {
        try {
          await contributors.insert({ id: `${group}|${pseudonym}`, group });
          return true;
        } catch (e) {
          if (e instanceof ConflictError) return false;
          throw e;
        }
      },
      contributors: (group) => contributors.count({ where: { group } }),
      deleteScope: (scope, scopeId) => counters.deleteWhere({ where: { series: `${scope}:${scopeId}` } }),
    },
    taxonomy: {
      findCategories: () => categories.find(),
      saveCategory: (c) => categories.upsert(c),
      findTopics: () => topics.find(),
      findTopic: (id) => topics.get(id),
      saveTopic: (t) => topics.upsert(t),
    },
    preferences: {
      findUser: (userId) => userPrefs.get(userId),
      saveUser: async (p) => {
        await userPrefs.upsert(p);
        await follows.deleteWhere({ where: { userId: p.userId } });
        for (const topicId of new Set(p.values.followedTopics ?? [])) await follows.upsert({ id: `${topicId}|${p.userId}`, topicId, userId: p.userId });
      },
      deleteUser: async (userId) => {
        await userPrefs.deleteWhere({ where: { id: userId } });
        await follows.deleteWhere({ where: { userId } });
      },
      findOrg: (orgId) => orgPrefs.get(orgId),
      saveOrg: (d) => orgPrefs.upsert(d),
      findUsersWithDigest: () => userPrefs.find({ where: { digest: { in: ["daily", "weekly"] } } }),
      findOrgsWithDigest: () => orgPrefs.find({ where: { digest: { in: ["daily", "weekly"] } } }),
      findFollowers: async (topicId) => {
        const ids = (await follows.find({ where: { topicId } })).map((x) => x.userId);
        return ids.length ? userPrefs.find({ where: { id: { in: ids } } }) : [];
      },
    },
    businessRules: {
      findLatest: async () => latestBy(await bizRules.find(), (r) => r.id),
      findVersions: (ruleId) => bizRules.find({ where: { ruleId }, orderBy: { field: "version", direction: "asc" } }),
      findActive: () => bizRules.find({ where: { status: "active" } }),
      save: (r) => bizRules.upsert(r),
      findParameters: async () => latestBy(await params.find(), (p) => p.key),
      parameterHistory: (key) => params.find({ where: { key }, orderBy: { field: "version", direction: "asc" } }),
      saveParameter: (v) => params.insert(v),
    },
    coupons: {
      find: (code) => coupons.get(code.toUpperCase()),
      findAll: () => coupons.find(),
      save: (c) => coupons.upsert(c),
      incrementRedemptions: async (code) => {
        for (let i = 0; i < 20; i++) {
          const c = await coupons.get(code.toUpperCase());
          if (!c || (c.maxRedemptions !== null && c.redemptions >= c.maxRedemptions)) return false;
          if (await coupons.updateIf({ ...c, redemptions: c.redemptions + 1 }, { redemptions: c.redemptions })) return true;
        }
        return false;
      },
      addRedemption: (r) => redemptions.insert(r),
      findRedemption: (code, subjectKey) => redemptions.get(`${code.toUpperCase()}|${subjectKey}`),
      findRedemptionsBySubject: (subjectKey) => redemptions.find({ where: { subject: subjectKey } }),
    },
    referrals: {
      findCodeByOwner: async (ownerId) => (await refCodes.find({ where: { ownerId }, limit: 1 }))[0],
      findCode: (code) => refCodes.get(code.toUpperCase()),
      insertCode: (c) => refCodes.insert(c),
      findUse: (referredUserId) => refUses.get(referredUserId),
      saveUse: (u) => refUses.upsert(u),
      findUsesByReferrer: (referrerId) => refUses.find({ where: { referrerId } }),
    },
    branding: {
      find: (orgId) => brandings.get(orgId),
      findByDomain: async (domain) => (await brandings.find({ where: { customDomain: domain.toLowerCase() }, limit: 1 }))[0],
      save: (b) => brandings.upsert(b),
    },
    learning: {
      findItems: () => quizItems.find(),
      saveItem: (i) => quizItems.upsert(i),
      findClassroom: (id) => classrooms.get(id),
      findClassroomByCode: async (code) => (await classrooms.find({ where: { joinCode: code.toUpperCase() }, limit: 1 }))[0],
      findClassroomsByTeacher: (teacherId) => classrooms.find({ where: { teacherId } }),
      saveClassroom: (c) => classrooms.upsert(c),
      addMember: (m) => members.insert(m),
      findMembers: (classroomId) => members.find({ where: { classroomId } }),
      findMemberships: (userId) => members.find({ where: { userId } }),
      addAttempt: (a) => quizAttempts.insert(a),
      findAttempts: (q) => quizAttempts.find({ where: { ...(q.playerId ? { playerId: q.playerId } : {}), ...(q.classroomId ? { classroomId: q.classroomId } : {}) } }),
      getState: (playerId) => lstates.get(playerId),
      saveState: (st) => lstates.upsert(st),
      deletePlayer: async (userId) => {
        await quizAttempts.deleteWhere({ where: { playerId: userId } });
        await members.deleteWhere({ where: { userId } });
        await lstates.deleteWhere({ where: { id: userId } });
      },
    },
    tickets: {
      save: (t) => tickets.upsert(t),
      findById: (id) => tickets.get(id),
      findByRequester: (userId) => tickets.find({ where: { requesterId: userId }, orderBy: { field: "createdAt", direction: "desc" } }),
      findOpen: () => tickets.find({ where: { status: { in: ["open", "pending"] } }, orderBy: { field: "createdAt", direction: "asc" } }),
    },
    consents: {
      save: (c) => consents.upsert(c),
      findByUser: (userId) => consents.find({ where: { userId } }),
      deleteByUser: (userId) => consents.deleteWhere({ where: { userId } }),
    },
    featureFlags: {
      find: (key) => flags.get(key),
      findAll: () => flags.find(),
      save: (fl) => flags.upsert(fl),
    },
    media: {
      put: (m: MediaRecord) => media.upsert(m),
      get: (id: string) => media.get(id),
      deleteExpired: (now: Date) => media.deleteWhere({ where: { expiresAt: { lte: now } } }),
    },
    evidence: {
      save: (s) => evidence.upsert(s),
      findById: (id) => evidence.get(id),
      findByUrlKey: (urlKey) => evidence.find({ where: { urlKey }, orderBy: { field: "capturedAt", direction: "asc" } }),
      findByRequester: (userId, limit) => evidence.find({ where: { requestedBy: userId }, orderBy: { field: "capturedAt", direction: "desc" }, limit }),
      countByRequesterSince: (userId, since) => evidence.count({ where: { requestedBy: userId, capturedAt: { gte: since } } }),
      findBySubject: (subjectId) => evidence.find({ where: { subjectId } }),
      findDueForRecheck: (now, checkedBefore, limit) =>
        evidence.find({ where: { current: 1, monitorUntil: { gte: now }, checkedAt: { lte: checkedBefore } }, orderBy: { field: "checkedAt", direction: "asc" }, limit }),
    },
    evidenceBlobs: {
      put: (b) => evidenceBlobs.upsert(b),
      get: (key) => evidenceBlobs.get(key),
    },
    digests: {
      insert: (d) => digests.insert(d),
      save: (d) => digests.upsert(d),
      findLastSent: async (userId) =>
        (await digests.find({ where: { userId, status: { in: ["sent", "deferred"] } }, orderBy: { field: "to", direction: "desc" }, limit: 1 }))[0],
      findByUser: (userId, limit) => digests.find({ where: { userId }, orderBy: { field: "to", direction: "desc" }, limit }),
      deleteByUser: (userId) => digests.deleteWhere({ where: { userId } }),
    },
    reportSchedules: {
      findById: (id) => schedules.get(id),
      findByOwner: (ownerId) => schedules.find({ where: { ownerId } }),
      findDue: (now) => schedules.find({ where: { active: true, nextRunAt: { lte: now } } }),
      save: (r) => schedules.upsert(r),
      delete: (id) => schedules.deleteWhere({ where: { id } }),
      deleteByOwner: (ownerId) => schedules.deleteWhere({ where: { ownerId } }),
    },
  };
}
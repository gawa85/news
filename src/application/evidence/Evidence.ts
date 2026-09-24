import { createHash } from "node:crypto";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import type { EvidenceChange, EvidenceReason, EvidenceSnapshot, EvidenceStatus, EvidenceVerification, User } from "../../domain/model";
import type {
  CapturedPage,
  IAuthorizationService,
  IClock,
  IDomainEvents,
  IEvidenceBlobStore,
  IEvidenceRepository,
  IExternalArchive,
  IIdGenerator,
  IJobQueue,
  ILogger,
  IPageCapturer,
  IParameterStore,
  ITimestampAuthority,
} from "../../domain/ports";
import { compareEvidenceText, evidenceRecordContent, evidenceUrlKey, normalizeEvidenceText } from "../../domain/rules/evidence";
import type { AccessControl } from "../access/AccessControl";

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const SYSTEM = "sistema:evidencias";

/** Los proveedores del archivo: se inyectan, el servicio no sabe cuáles son (DIP). */
export interface EvidenceProviders {
  capturer: IPageCapturer;
  blobs: IEvidenceBlobStore;
  timestamp?: ITimestampAuthority;
  archives?: IExternalArchive[];
}

interface RecordInput {
  url: string;
  requestedBy: string;
  subjectId: string;
  reason: EvidenceReason;
  monitorUntil?: Date;
  actor: { userId: string; organizationId?: string };
}

/**
 * ARCHIVO DE EVIDENCIAS: copia de una nota tal como estaba, con huella SHA-256, cadena de
 * registros por URL, sello de tiempo de un tercero y copia en un archivo público.
 *
 * REGLAS:
 *  - Hace falta el permiso `evidence:capture` y la funcionalidad `evidence_archive` del plan;
 *    tope diario por persona (`evidence.max_per_day`).
 *  - Se guardan el archivo tal como llegó y su texto normalizado (el que se compara).
 *  - Con seguimiento, la nota se vuelve a mirar cada `evidence.recheck_hours`: si cambió se
 *    guarda otra captura con lo agregado y lo quitado; si la borraron, queda registrado.
 *    Si no cambió, no se crea otra captura (sólo se anota que se miró).
 *  - Cada persona ve sus capturas (y las de su organización); los verificadores, todas.
 */
export class EvidenceService {
  private readonly archives: IExternalArchive[];

  constructor(
    private readonly repo: IEvidenceRepository,
    private readonly providers: EvidenceProviders,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
    private readonly params: IParameterStore,
    private readonly events: IDomainEvents,
    private readonly queue: IJobQueue | undefined,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly logger: ILogger,
  ) {
    this.archives = providers.archives ?? [];
  }

  // ---------------- Capturar ----------------

  async capture(input: { actorId: string; url: string; monitor?: boolean }): Promise<{ snapshot: EvidenceSnapshot }> {
    const user = await this.access.userOrThrow(input.actorId);
    if (!(await this.authz.permissionsOf(user)).has("evidence:capture")) throw new AccessDeniedError("No podés archivar notas.", "no_permission");
    const { plan, subject } = await this.access.planOf(user);
    if (!plan.features.includes("evidence_archive")) throw new AccessDeniedError(`El archivo de evidencias no está incluido en el plan ${plan.name}.`, "feature_not_in_plan");
    const now = this.clock.now();
    const max = await this.params.number("evidence.max_per_day");
    if ((await this.repo.countByRequesterSince(user.id, new Date(now.getTime() - 86_400_000))) >= max) {
      throw new AccessDeniedError(`Llegaste al máximo de ${max} copias por día.`, "quota_exceeded");
    }
    let url: URL;
    try {
      url = new URL(input.url.trim());
    } catch {
      throw new ValidationError("El link no es válido.");
    }
    const monitorUntil = input.monitor ? new Date(now.getTime() + (await this.params.number("evidence.monitor_days")) * 86_400_000) : undefined;
    const r = await this.record({ url: url.toString(), requestedBy: user.id, subjectId: subject.id, reason: "manual", monitorUntil, actor: { userId: user.id, organizationId: user.organizationId } });
    return { snapshot: r.snapshot };
  }

  private async record(input: RecordInput): Promise<{ snapshot: EvidenceSnapshot; unchanged: boolean }> {
    const urlKey = evidenceUrlKey(input.url);
    const history = await this.repo.findByUrlKey(urlKey);
    const latest = history.at(-1);
    const lastCaptured = [...history].reverse().find((s) => s.status === "captured");
    const now = this.clock.now();

    let page: CapturedPage | undefined;
    let error: string | undefined;
    try {
      page = await this.providers.capturer.capture(input.url, (await this.params.number("evidence.max_mb")) * 1024 * 1024);
    } catch (e) {
      // Una dirección prohibida o inválida se le dice a quien la pidió; un error de red queda registrado.
      if (input.reason === "manual" && e instanceof ValidationError) throw e;
      error = e instanceof Error ? e.message : String(e);
    }
    const status: EvidenceStatus = !page ? "failed" : page.status === 404 || page.status === 410 ? "gone" : page.status >= 400 ? "failed" : "captured";
    if (page && status === "failed") error = `La página respondió ${page.status}.`;
    const text = page && status === "captured" ? normalizeEvidenceText(page.text) : undefined;
    const textSha256 = text === undefined ? undefined : sha256(text);

    // Seguimiento sin novedades (o con un error pasajero): se anota que se miró y listo.
    if (input.reason === "recheck" && latest) {
      const same = status === "failed" || (status === latest.status && (status === "gone" || latest.textSha256 === textSha256));
      if (same) {
        const touched = { ...latest, lastCheckedAt: now };
        await this.repo.save(touched);
        return { snapshot: touched, unchanged: true };
      }
    }

    const id = this.ids.next("ev");
    const blobs: EvidenceSnapshot["blobs"] = [];
    if (page && text !== undefined) {
      const base = `evidencias/${sha256(urlKey).slice(0, 16)}/${id.replace(/[^\w-]/g, "")}`;
      const { blobs: store } = this.providers;
      await store.put(`${base}.raw`, page.body, page.mime);
      await store.put(`${base}.txt`, Buffer.from(text, "utf8"), "text/plain; charset=utf-8");
      blobs.push({ kind: "raw", provider: store.provider, key: `${base}.raw` }, { kind: "text", provider: store.provider, key: `${base}.txt` });
    }
    let change: EvidenceChange | undefined;
    if (text !== undefined && lastCaptured && lastCaptured.textSha256 !== textSha256) {
      change = compareEvidenceText((await this.blobText(lastCaptured)) ?? "", text);
    }
    const monitorUntil = [input.monitorUntil, latest?.monitorUntil].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];

    const content: Omit<EvidenceSnapshot, "recordHash"> = {
      id,
      url: input.url,
      finalUrl: page?.finalUrl ?? input.url,
      urlKey,
      capturedAt: now,
      requestedBy: input.requestedBy,
      subjectId: input.subjectId,
      reason: input.reason,
      status,
      httpStatus: page?.status,
      error,
      title: page?.title,
      mime: page?.mime,
      bytes: page?.body.length,
      rawSha256: page && text !== undefined ? sha256(page.body) : undefined,
      textSha256,
      blobs,
      previousId: latest?.id,
      change,
      previousRecordHash: latest?.recordHash,
      externalCopies: [],
      monitorUntil,
    };
    const snapshot: EvidenceSnapshot = { ...content, recordHash: sha256(evidenceRecordContent(content)) };
    await this.repo.save(snapshot);
    if (latest) await this.repo.save({ ...(await this.repo.findById(latest.id))!, supersededBy: id });

    const target = { type: "evidence", id };
    await this.events.emit("evidence.captured", input.actor, { url: snapshot.finalUrl, status, reason: input.reason }, target);
    if (change && (change.added.length || change.removed.length)) {
      await this.events.emit("evidence.changed", input.actor, { url: snapshot.finalUrl, previousId: lastCaptured!.id, added: change.added.length, removed: change.removed.length }, target);
    }
    if (status === "gone" && lastCaptured && latest?.status !== "gone") {
      await this.events.emit("evidence.gone", input.actor, { url: snapshot.finalUrl, previousId: lastCaptured.id }, target);
    }
    if (status !== "failed" && (this.providers.timestamp || this.archives.length)) {
      await this.queue?.enqueue("evidence_seal", { id }, { dedupeKey: `evidence_seal:${id}`, maxAttempts: 6 });
    }
    return { snapshot, unchanged: false };
  }

  // ---------------- Sello y copia pública (por la cola) ----------------

  /** Copia pública (si falla, se registra y sigue) y sello de tiempo (si falla, la cola reintenta). */
  async seal(id: string): Promise<void> {
    const s = await this.repo.findById(id);
    if (!s) return;
    const copies = [...s.externalCopies];
    if (s.status === "captured") {
      for (const a of this.archives) {
        if (copies.some((c) => c.provider === a.id)) continue;
        try {
          copies.push({ provider: a.id, ...(await a.archive(s.finalUrl)) });
        } catch (e) {
          this.logger.warn("No se pudo guardar la copia pública", { provider: a.id, id, error: String(e) });
        }
      }
    }
    let timestamp = s.timestamp;
    let failure: unknown;
    const tsa = this.providers.timestamp;
    if (tsa && !timestamp) {
      try {
        const t = await tsa.stamp(s.recordHash);
        timestamp = { provider: tsa.id, token: t.token, at: t.at };
      } catch (e) {
        failure = e;
      }
    }
    // Se relee: mientras tanto pudo llegar una captura nueva (supersededBy).
    const fresh = (await this.repo.findById(id))!;
    await this.repo.save({ ...fresh, externalCopies: copies, ...(timestamp ? { timestamp } : {}) });
    if (failure) throw failure;
  }

  // ---------------- Seguimiento ----------------

  async recheckDue(limit = 20): Promise<{ checked: number; changed: number }> {
    const now = this.clock.now();
    const hours = await this.params.number("evidence.recheck_hours");
    const due = await this.repo.findDueForRecheck(now, new Date(now.getTime() - hours * 3_600_000), limit);
    let changed = 0;
    for (const s of due) {
      try {
        const r = await this.record({ url: s.url, requestedBy: SYSTEM, subjectId: s.subjectId, reason: "recheck", monitorUntil: s.monitorUntil, actor: { userId: SYSTEM } });
        if (!r.unchanged) changed++;
      } catch (e) {
        this.logger.warn("Falló el seguimiento de una evidencia", { id: s.id, error: String(e) });
      }
    }
    return { checked: due.length, changed };
  }

  // ---------------- Consultar y verificar ----------------

  async get(actorId: string, id: string): Promise<EvidenceSnapshot> {
    const user = await this.access.userOrThrow(actorId);
    const s = await this.repo.findById(id);
    if (!s || !(await this.canSee(user, s))) throw new NotFoundError("No existe esa copia.");
    return s;
  }

  async listMine(actorId: string, limit = 50): Promise<EvidenceSnapshot[]> {
    return this.repo.findByRequester((await this.access.userOrThrow(actorId)).id, Math.min(limit, 200));
  }

  /** Todas las versiones de una nota que la persona puede ver (las propias, las del seguimiento). */
  async history(actorId: string, url: string): Promise<EvidenceSnapshot[]> {
    const user = await this.access.userOrThrow(actorId);
    let key: string;
    try {
      key = evidenceUrlKey(url);
    } catch {
      throw new ValidationError("El link no es válido.");
    }
    const all = await this.repo.findByUrlKey(key);
    const visible: EvidenceSnapshot[] = [];
    for (const s of all) if (await this.canSee(user, s)) visible.push(s);
    return visible;
  }

  /** El archivo guardado, tal como llegó ("raw") o su texto ("text"). */
  async content(actorId: string, id: string, kind: "raw" | "text"): Promise<{ data: Buffer; mime: string }> {
    const s = await this.get(actorId, id);
    const ref = s.blobs.find((b) => b.kind === kind);
    const data = ref ? await this.providers.blobs.get(ref.key) : undefined;
    if (!data) throw new NotFoundError("Esa copia no tiene ese archivo.");
    return { data, mime: kind === "text" ? "text/plain; charset=utf-8" : (s.mime ?? "application/octet-stream") };
  }

  /** Recalcula todo: huella del registro, cadena hasta el primero, archivos y sello. */
  async verify(actorId: string, id: string): Promise<EvidenceVerification> {
    const s = await this.get(actorId, id);
    const checks: EvidenceVerification["checks"] = [];
    const { recordHash: _, ...content } = s;
    checks.push({ name: "Huella del registro", ok: sha256(evidenceRecordContent(content)) === s.recordHash });

    let chainOk = true;
    let detail: string | undefined;
    for (let cur: EvidenceSnapshot | undefined = s; cur?.previousId; ) {
      const prev: EvidenceSnapshot | undefined = await this.repo.findById(cur.previousId);
      const { recordHash: __, ...prevContent } = prev ?? ({} as EvidenceSnapshot);
      if (!prev || cur.previousRecordHash !== prev.recordHash || sha256(evidenceRecordContent(prevContent)) !== prev.recordHash) {
        chainOk = false;
        detail = `Se rompe en ${prev?.id ?? cur.previousId}.`;
        break;
      }
      cur = prev;
    }
    checks.push({ name: "Cadena de capturas anteriores", ok: chainOk, detail });

    for (const b of s.blobs) {
      const data = await this.providers.blobs.get(b.key);
      const expected = b.kind === "raw" ? s.rawSha256 : s.textSha256;
      checks.push({ name: b.kind === "raw" ? "Archivo original" : "Texto", ok: !!data && sha256(data) === expected, detail: data ? undefined : "No se encontró el archivo." });
    }
    if (this.providers.timestamp) {
      checks.push({
        name: "Sello de tiempo",
        ok: !!s.timestamp,
        detail: s.timestamp ? `${s.timestamp.provider}, ${s.timestamp.at.toISOString()}` : "Pendiente.",
      });
    }
    return { snapshotId: s.id, ok: checks.every((c) => c.ok), checks };
  }

  private async canSee(user: User, s: EvidenceSnapshot): Promise<boolean> {
    if (s.requestedBy === user.id || s.subjectId === user.id) return true;
    if (user.organizationId && s.subjectId === user.organizationId) return true;
    return (await this.authz.permissionsOf(user)).has("evidence:read_all");
  }

  private async blobText(s: EvidenceSnapshot): Promise<string | undefined> {
    const ref = s.blobs.find((b) => b.kind === "text");
    return ref ? (await this.providers.blobs.get(ref.key))?.toString("utf8") : undefined;
  }
}

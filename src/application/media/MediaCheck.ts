import { ValidationError } from "../../domain/errors";
import type { MediaInspection, MediaReport, MediaSighting } from "../../domain/model";
import type { IClock, ILogger, IMediaFingerprintRepository, IMediaInspector, IVideoFrameSampler } from "../../domain/ports";
import { hashBands, isInformativeHash, mediaReport, perceptualHashesOf, sameFootage } from "../../domain/rules/mediaForensics";

/**
 * ¿ESTA IMAGEN O VIDEO ES LO QUE DICE SER? Sin servicios externos:
 *  1. Qué dicen sus datos internos (fecha, programa, marca de IA, credenciales C2PA).
 *  2. Si ya circuló: huella exacta y perceptual contra todo lo que nos mandaron antes. En los
 *     videos, la huella de cuadros repartidos a lo largo del video: así se reconoce aunque
 *     WhatsApp o Telegram lo hayan recomprimido, y una foto que es una captura de un video.
 * REGLAS:
 *  - No se guarda el archivo ni quién lo mandó: sólo las huellas, la primera y la última vez, y cuántas.
 *  - Ninguna señal prueba que sea falso; el informe dice qué se sabe y qué mirar.
 *  - Si no se pueden sacar los cuadros de un video, se sigue con lo demás (no es un error para la persona).
 */
export class MediaCheckService {
  constructor(
    private readonly inspector: IMediaInspector,
    private readonly fingerprints: IMediaFingerprintRepository,
    private readonly clock: IClock,
    private readonly opts: { maxBytes: number } = { maxBytes: 20 * 1024 * 1024 },
    private readonly frames?: IVideoFrameSampler,
    private readonly logger?: ILogger,
  ) {}

  async check(file: { data: Buffer; mime: string }, context: { channel?: string } = {}): Promise<MediaReport & { inspection: MediaInspection }> {
    if (file.data.length > this.opts.maxBytes) throw new ValidationError(`El archivo supera ${Math.round(this.opts.maxBytes / 1024 / 1024)} MB.`);
    const found = await this.inspector.inspect(file.data, file.mime);
    if (!found) throw new ValidationError("Por ahora reviso fotos (JPEG, PNG, WebP) y videos (MP4, MOV).");
    const inspection = found.kind === "video" ? await this.withFrames(found, file.data) : found;
    const now = this.clock.now();
    const seen = await this.sighting(inspection);
    await this.remember(inspection, now);
    return { ...mediaReport(inspection, now, seen, context.channel), inspection };
  }

  /** Huellas de cuadros del video (si hay con qué sacarlos). */
  private async withFrames(i: MediaInspection, data: Buffer): Promise<MediaInspection> {
    if (!this.frames) return i;
    try {
      const sampled = await this.frames.sample(data, i.mime);
      if (!sampled) return i;
      const hashes: string[] = [];
      for (const f of sampled.frames) {
        const h = (await this.inspector.inspect(f, "image/png"))?.perceptualHash;
        if (h && isInformativeHash(h)) hashes.push(h);
      }
      return { ...i, frameHashes: hashes.length ? hashes : undefined, durationSeconds: sampled.durationSeconds ?? i.durationSeconds };
    } catch (err) {
      this.logger?.warn("No se pudieron sacar los cuadros del video", { error: err instanceof Error ? err.message : String(err) });
      return i;
    }
  }

  private async sighting(i: MediaInspection): Promise<MediaSighting | undefined> {
    const same = await this.fingerprints.get(i.sha256);
    if (same) return { firstSeenAt: same.firstSeenAt, lastSeenAt: same.lastSeenAt, times: same.times, match: "same" };
    const mine = perceptualHashesOf(i);
    if (!mine.length) return undefined;
    const bands = [...new Set(mine.flatMap(hashBands))];
    const close = (await this.fingerprints.findByBands(bands, 50))
      .filter((f) => f.id !== i.sha256 && sameFootage(mine, perceptualHashesOf(f)))
      .sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
    if (!close.length) return undefined;
    const first = close[0]!;
    return {
      firstSeenAt: first.firstSeenAt,
      lastSeenAt: close.reduce((d, f) => (f.lastSeenAt > d ? f.lastSeenAt : d), first.lastSeenAt),
      times: close.reduce((n, f) => n + f.times, 0),
      match: "similar",
      otherKind: first.kind !== i.kind ? first.kind : undefined,
    };
  }

  private async remember(i: MediaInspection, now: Date): Promise<void> {
    const prev = await this.fingerprints.get(i.sha256);
    const hashes = perceptualHashesOf(i);
    await this.fingerprints.save(
      { id: i.sha256, kind: i.kind, perceptualHash: i.perceptualHash, frameHashes: i.frameHashes, firstSeenAt: prev?.firstSeenAt ?? now, lastSeenAt: now, times: (prev?.times ?? 0) + 1 },
      [...new Set(hashes.flatMap(hashBands))],
    );
  }
}

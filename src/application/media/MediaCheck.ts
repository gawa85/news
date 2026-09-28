import { ValidationError } from "../../domain/errors";
import type { MediaInspection, MediaReport, MediaSighting } from "../../domain/model";
import type { IClock, IMediaFingerprintRepository, IMediaInspector } from "../../domain/ports";
import { hammingDistance, hashBands, mediaReport, SIMILAR_MAX_DISTANCE } from "../../domain/rules/mediaForensics";

/**
 * ¿ESTA IMAGEN O VIDEO ES LO QUE DICE SER? Sin servicios externos:
 *  1. Qué dicen sus datos internos (fecha, programa, marca de IA, credenciales C2PA).
 *  2. Si ya circuló: huella exacta y perceptual contra todo lo que nos mandaron antes.
 * REGLAS:
 *  - No se guarda el archivo ni quién lo mandó: sólo la huella, la primera y la última vez, y cuántas.
 *  - Ninguna señal prueba que sea falso; el informe dice qué se sabe y qué mirar.
 */
export class MediaCheckService {
  constructor(
    private readonly inspector: IMediaInspector,
    private readonly fingerprints: IMediaFingerprintRepository,
    private readonly clock: IClock,
    private readonly opts: { maxBytes: number } = { maxBytes: 20 * 1024 * 1024 },
  ) {}

  async check(file: { data: Buffer; mime: string }, context: { channel?: string } = {}): Promise<MediaReport & { inspection: MediaInspection }> {
    if (file.data.length > this.opts.maxBytes) throw new ValidationError(`El archivo supera ${Math.round(this.opts.maxBytes / 1024 / 1024)} MB.`);
    const inspection = await this.inspector.inspect(file.data, file.mime);
    if (!inspection) throw new ValidationError("Por ahora reviso fotos (JPEG, PNG, WebP) y videos (MP4, MOV).");
    const now = this.clock.now();
    const seen = await this.sighting(inspection);
    await this.remember(inspection, now);
    return { ...mediaReport(inspection, now, seen, context.channel), inspection };
  }

  private async sighting(i: MediaInspection): Promise<MediaSighting | undefined> {
    const same = await this.fingerprints.get(i.sha256);
    if (same) return { firstSeenAt: same.firstSeenAt, lastSeenAt: same.lastSeenAt, times: same.times, match: "same" };
    if (!i.perceptualHash) return undefined;
    const close = (await this.fingerprints.findByBands(hashBands(i.perceptualHash), 50))
      .filter((f) => f.perceptualHash && hammingDistance(f.perceptualHash, i.perceptualHash!) <= SIMILAR_MAX_DISTANCE)
      .sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
    if (!close.length) return undefined;
    return {
      firstSeenAt: close[0]!.firstSeenAt,
      lastSeenAt: close.reduce((d, f) => (f.lastSeenAt > d ? f.lastSeenAt : d), close[0]!.lastSeenAt),
      times: close.reduce((n, f) => n + f.times, 0),
      match: "similar",
    };
  }

  private async remember(i: MediaInspection, now: Date): Promise<void> {
    const prev = await this.fingerprints.get(i.sha256);
    await this.fingerprints.save(
      { id: i.sha256, kind: i.kind, perceptualHash: i.perceptualHash, firstSeenAt: prev?.firstSeenAt ?? now, lastSeenAt: now, times: (prev?.times ?? 0) + 1 },
      i.perceptualHash ? hashBands(i.perceptualHash) : [],
    );
  }
}

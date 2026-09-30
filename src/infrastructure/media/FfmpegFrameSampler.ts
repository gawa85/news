import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IVideoFrameSampler } from "../../domain/ports";

/** Corre un programa y devuelve lo que escribió (con tiempo límite). */
export type ProcessRunner = (cmd: string, args: string[], timeoutMs: number) => Promise<string>;

const runProcess: ProcessRunner = (cmd, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024, killSignal: "SIGKILL", windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd}: ${(stderr || err.message).toString().slice(0, 300)}`));
      else resolve(stdout.toString());
    });
  });

/** Formatos que se aceptan, con el demuxer de ffmpeg que se FUERZA para cada uno. */
const FORMATS: Record<string, string> = { "video/mp4": "mov", "video/quicktime": "mov" };

/**
 * CUADROS DE UN VIDEO con ffmpeg (local, sin servicios externos): N cuadros repartidos a lo largo
 * del video, chicos (160 px de ancho), en PNG.
 * SEGURIDAD (el archivo lo manda cualquiera):
 *  - Se fuerza el formato (-f mov): ffmpeg no adivina por el contenido, así un archivo disfrazado
 *    (una lista de reproducción, un "concat") no lo hace leer otros archivos ni salir a internet.
 *  - Sólo el protocolo "file" y sin referencias externas del formato MOV (enable_drefs 0).
 *  - Un hilo, sin audio ni subtítulos, con tiempo límite; el archivo temporal va a una carpeta
 *    propia y se borra siempre.
 */
export class FfmpegFrameSampler implements IVideoFrameSampler {
  constructor(
    private readonly opts: { ffmpeg?: string; ffprobe?: string; frames?: number; width?: number; timeoutMs?: number; tmpDir?: string } = {},
    private readonly runner: ProcessRunner = runProcess,
  ) {}

  async sample(data: Buffer, mime: string): Promise<{ frames: Buffer[]; durationSeconds?: number } | undefined> {
    const format = FORMATS[mime];
    if (!format) return undefined;
    const timeout = this.opts.timeoutMs ?? 20_000;
    const count = this.opts.frames ?? 8;
    const safeInput = ["-f", format, "-protocol_whitelist", "file", "-enable_drefs", "0"];
    const dir = await mkdtemp(join(this.opts.tmpDir ?? tmpdir(), "sinhumo-video-"));
    try {
      const input = join(dir, "entrada");
      await writeFile(input, data, { mode: 0o600 });
      const raw = await this.runner(this.opts.ffprobe ?? "ffprobe", ["-v", "error", ...safeInput, "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input], timeout);
      const duration = Number.parseFloat(raw.trim());
      if (!Number.isFinite(duration) || duration <= 0) return undefined;
      await this.runner(
        this.opts.ffmpeg ?? "ffmpeg",
        [
          "-nostdin", "-hide_banner", "-v", "error", "-threads", "1", ...safeInput, "-i", input,
          "-an", "-sn", "-dn", "-vf", `fps=${(count / duration).toFixed(6)},scale=${this.opts.width ?? 160}:-2`, "-frames:v", String(count),
          "-f", "image2", join(dir, "cuadro-%02d.png"),
        ],
        timeout,
      );
      const names = (await readdir(dir)).filter((n) => /^cuadro-\d+\.png$/.test(n)).sort();
      const frames = await Promise.all(names.map((n) => readFile(join(dir, n))));
      return frames.length ? { frames, durationSeconds: Math.round(duration * 10) / 10 } : undefined;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

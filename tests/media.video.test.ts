/** Videos: reconocerlos aunque los hayan recomprimido (cuadros con ffmpeg), sin abrirle la puerta a archivos disfrazados. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { promisify } from "node:util";
import { MediaCheckService } from "../src/application/media/MediaCheck";
import { isInformativeHash, sameFootage } from "../src/domain/rules/mediaForensics";
import { FfmpegFrameSampler } from "../src/infrastructure/media/FfmpegFrameSampler";
import { LocalMediaInspector } from "../src/infrastructure/media/LocalMediaInspector";
import { SilentLogger } from "../src/infrastructure/system/System";
import { testPlatform } from "./helpers/platform";

const exec = promisify(execFile);
const DAY = 86_400_000;

describe("Mismo material (regla pura)", () => {
  const a = "f0f0f0f0f0f0f0f0";
  const b = "0f0f0f0f0f0f0f0f";
  const c = "ffff0000ffff0000";
  const d = "3c3c3c3c3c3c3c3c";
  test("una imagen contra un video: alcanza con un cuadro; entre videos, al menos 2 y un cuarto del más corto", () => {
    assert.equal(sameFootage([a], [b, c, a]), true, "una captura de un video");
    assert.equal(sameFootage([a, b, c, d], [a, "aaaaaaaaaaaaaaaa", "5555555555555555", "1234123412341234"]), false, "un solo cuadro parecido entre videos no alcanza");
    assert.equal(sameFootage([a, b, c, d], [a, b, "5555555555555555", "1234123412341234"]), true);
    assert.equal(sameFootage([], [a]), false);
  });
  test("las pantallas lisas (negro, fundidos) no cuentan", () => {
    assert.equal(isInformativeHash("0000000000000000"), false);
    assert.equal(isInformativeHash("ffffffffffffffff"), false);
    assert.equal(isInformativeHash("f0f0f0f0f0f0f0f0"), true);
  });
});

describe("ffmpeg: protecciones", () => {
  test("fuerza el formato, sólo lee el archivo temporal y lo borra siempre (aunque falle)", async () => {
    const calls: string[][] = [];
    const dirs: string[] = [];
    const sampler = new FfmpegFrameSampler({ frames: 4, timeoutMs: 1234 }, async (cmd, args, timeout) => {
      calls.push([cmd, ...args, `timeout=${timeout}`]);
      dirs.push(args[args.length - 1]!.replace(/[/\\][^/\\]+$/, ""));
      if (cmd === "ffprobe") return "12.5\n";
      throw new Error("ffmpeg falló");
    });
    assert.equal(await sampler.sample(Buffer.from("x"), "video/webm"), undefined, "formato no aceptado: ni se intenta");
    await assert.rejects(sampler.sample(Buffer.from("xxxx"), "video/mp4"), /ffmpeg falló/);
    for (const call of calls) {
      const i = call.indexOf("-f");
      assert.equal(call[i + 1], "mov", `${call[0]} con el formato forzado`);
      assert.equal(call[call.indexOf("-protocol_whitelist") + 1], "file");
      assert.equal(call[call.indexOf("-enable_drefs") + 1], "0");
      assert.ok(call.includes("timeout=1234"));
    }
    assert.ok(calls[1]!.includes("-an") && calls[1]!.includes("fps=0.320000,scale=160:-2"));
    for (const dir of new Set(dirs)) assert.deepEqual(await readdir(dir).catch(() => "borrada"), "borrada");
  });
});

describe("Videos de verdad (ffmpeg)", () => {
  let work: string;
  const make = async (name: string, ...args: string[]) => {
    const out = join(work, name);
    await exec("ffmpeg", ["-v", "error", "-y", ...args, out], { timeout: 60_000 });
    return readFile(out);
  };
  let original: Buffer;
  let recompressed: Buffer;
  let other: Buffer;
  let still: Buffer;

  before(async () => {
    work = await mkdtemp(join(tmpdir(), "sinhumo-prueba-video-"));
    original = await make("original.mp4", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=8", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "20");
    // Como lo reenvía WhatsApp: otra resolución y mucha más compresión.
    recompressed = await make("reenviado.mp4", "-i", join(work, "original.mp4"), "-vf", "scale=176:132", "-c:v", "libx264", "-crf", "35");
    other = await make("otro.mp4", "-f", "lavfi", "-i", "mandelbrot=size=320x240:rate=15", "-t", "8", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "20");
    still = await make("captura.png", "-ss", "3", "-i", join(work, "original.mp4"), "-frames:v", "1");
  });
  after(() => rm(work, { recursive: true, force: true }));

  test("un video recomprimido se reconoce; uno distinto no; una captura es 'un cuadro de un video'", async () => {
    const t = await testPlatform();
    const svc = new MediaCheckService(new LocalMediaInspector(), t.store.repos.mediaFingerprints, t.clock, undefined, new FfmpegFrameSampler(), new SilentLogger());
    const first = await svc.check({ data: original, mime: "video/mp4" });
    assert.ok(first.inspection.frameHashes!.length >= 6, "saca los cuadros");
    assert.ok(first.inspection.durationSeconds! > 7);
    assert.ok(!first.signals.some((s) => s.id === "seen_before"));

    t.clock.advance(3 * DAY);
    const again = await svc.check({ data: recompressed, mime: "video/mp4" });
    const seen = again.signals.find((s) => s.id === "seen_before");
    assert.ok(seen, "el reenviado (recomprimido) ya circuló");
    assert.match(seen!.detail, /mismas escenas/);

    const distinct = await svc.check({ data: other, mime: "video/mp4" });
    assert.ok(!distinct.signals.some((s) => s.id === "seen_before"), "otro video no coincide");

    const shot = await svc.check({ data: still, mime: "image/png" });
    assert.match(shot.signals.find((s) => s.id === "seen_before")!.detail, /es un cuadro de un video/);
  });

  test("un archivo disfrazado de video (una lista que apunta a /etc/passwd) no se lee", async () => {
    const disguised = Buffer.from("#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n");
    await assert.rejects(new FfmpegFrameSampler().sample(disguised, "video/mp4"));
  });
});

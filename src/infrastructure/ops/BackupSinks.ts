/**
 * Destinos de las copias de seguridad. Regla de oro: la copia vive en OTRO lugar que la base
 * (otra cuenta u otro proveedor), así un problema en uno no se lleva al otro.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { IBackupSink } from "../../domain/ports";

const safeKey = (key: string) => {
  if (!/^[\w./-]+$/.test(key) || key.split("/").includes("..")) throw new Error(`Clave inválida: ${key}`);
  return key;
};

/** Disco (un volumen montado, un NAS). */
export class FileSystemBackupSink implements IBackupSink {
  readonly id = "disco";
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  private path(key: string): string {
    const p = resolve(this.root, safeKey(key));
    if (!p.startsWith(this.root + sep)) throw new Error("Ruta fuera del directorio de copias.");
    return p;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(`${p}.tmp`, data, { mode: 0o600 });
    await rm(p, { force: true });
    await writeFile(p, data, { mode: 0o600 });
    await rm(`${p}.tmp`, { force: true });
  }

  async get(key: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.path(key));
    } catch {
      return undefined;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string) => {
      let entries: import("node:fs").Dirent[] = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (!e.name.endsWith(".tmp")) out.push(relative(this.root, p).split(sep).join("/"));
      }
    };
    await walk(this.root);
    return out.filter((k) => k.startsWith(prefix)).sort();
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/** S3 o compatible (Cloudflare R2, MinIO, Backblaze B2, DigitalOcean Spaces). */
export class S3BackupSink implements IBackupSink {
  readonly id = "s3";
  private readonly s3: S3Client;

  constructor(private readonly cfg: { bucket: string; region?: string; endpoint?: string; accessKeyId: string; secretAccessKey: string; prefix?: string }) {
    this.s3 = new S3Client({
      region: cfg.region ?? "auto",
      endpoint: cfg.endpoint,
      forcePathStyle: !!cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  private k(key: string) {
    return `${this.cfg.prefix ?? ""}${safeKey(key)}`;
  }

  async put(key: string, data: Buffer): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: this.k(key), Body: data, ServerSideEncryption: this.cfg.endpoint ? undefined : "AES256" }));
  }

  async get(key: string): Promise<Buffer | undefined> {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.k(key) }));
      return Buffer.from(await r.Body!.transformToByteArray());
    } catch (e) {
      if ((e as { name?: string }).name === "NoSuchKey") return undefined;
      throw e;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let token: string | undefined;
    do {
      const r = await this.s3.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: this.k(prefix), ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key) out.push(o.Key.slice((this.cfg.prefix ?? "").length));
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out.sort();
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: this.k(key) }));
  }
}

/** Para tests. */
export class MemoryBackupSink implements IBackupSink {
  readonly id = "memoria";
  readonly files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.files.set(safeKey(key), Buffer.from(data));
  }
  async get(key: string) {
    return this.files.get(key);
  }
  async list(prefix: string) {
    return [...this.files.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

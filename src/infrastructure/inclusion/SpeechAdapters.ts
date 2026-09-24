/**
 * NOTAS DE VOZ: bajar el audio de cada canal y pasarlo a texto.
 * Se usa `fetch` (inyectable para tests) porque los audios son binarios.
 */
import { ValidationError } from "../../domain/errors";
import type { ChannelType } from "../../domain/model";
import type { IInboundMediaFetcher, ISpeechToText } from "../../domain/ports";

type FetchFn = typeof fetch;

async function download(fetchFn: FetchFn, url: string, maxBytes: number, headers: Record<string, string> = {}): Promise<{ data: Buffer; mime: string }> {
  const res = await fetchFn(url, { headers });
  if (!res.ok) throw new Error(`No se pudo bajar el audio (HTTP ${res.status}).`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new ValidationError("El audio es demasiado grande.");
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > maxBytes) throw new ValidationError("El audio es demasiado grande.");
  return { data, mime: res.headers.get("content-type") ?? "application/octet-stream" };
}

/** WhatsApp Cloud API: primero se pide el link del archivo (vence en minutos) y después se baja, con el token. */
export class WhatsAppMediaFetcher implements IInboundMediaFetcher {
  readonly channel = "whatsapp" as const;

  constructor(
    private readonly cfg: { accessToken: string; apiVersion?: string },
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async fetch(ref: string, maxBytes: number): Promise<{ data: Buffer; mime: string }> {
    const auth = { authorization: `Bearer ${this.cfg.accessToken}` };
    const res = await this.fetchFn(`https://graph.facebook.com/${this.cfg.apiVersion ?? "v21.0"}/${encodeURIComponent(ref)}`, { headers: auth });
    if (!res.ok) throw new Error(`WhatsApp no devolvió el audio (HTTP ${res.status}).`);
    const info = (await res.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!info.url) throw new Error("WhatsApp no devolvió el link del audio.");
    if ((info.file_size ?? 0) > maxBytes) throw new ValidationError("El audio es demasiado grande.");
    const file = await download(this.fetchFn, info.url, maxBytes, auth);
    return { data: file.data, mime: info.mime_type ?? file.mime };
  }
}

/** Telegram Bot API: getFile da la ruta y el archivo se baja de /file/bot<token>/<ruta> (hasta 20 MB). */
export class TelegramFileFetcher implements IInboundMediaFetcher {
  readonly channel = "telegram" as const;

  constructor(
    private readonly botToken: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async fetch(ref: string, maxBytes: number): Promise<{ data: Buffer; mime: string }> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.botToken}/getFile?file_id=${encodeURIComponent(ref)}`);
    const info = (await res.json()) as { ok?: boolean; result?: { file_path?: string; file_size?: number }; description?: string };
    if (!info.ok || !info.result?.file_path) throw new Error(`Telegram no devolvió el audio: ${info.description ?? res.status}`);
    if ((info.result.file_size ?? 0) > maxBytes) throw new ValidationError("El audio es demasiado grande.");
    return download(this.fetchFn, `https://api.telegram.org/file/bot${this.botToken}/${info.result.file_path}`, maxBytes);
  }
}

const EXTENSIONS: Record<string, string> = {
  "audio/ogg": "ogg", "audio/opus": "ogg", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/m4a": "m4a",
  "audio/x-m4a": "m4a", "audio/aac": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm", "audio/amr": "amr",
};

/**
 * Cualquier servicio con la API de transcripción de OpenAI (`POST /audio/transcriptions`):
 * OpenAI (whisper-1, gpt-4o-mini-transcribe), Groq (whisper-large-v3) o un servidor propio.
 */
export class OpenAiCompatibleSpeechToText implements ISpeechToText {
  readonly id: string;

  constructor(
    private readonly cfg: { apiKey: string; baseUrl?: string; model?: string; id?: string },
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.id = cfg.id ?? "openai-stt";
  }

  async transcribe(audio: { data: Buffer; mime: string }, language: string): Promise<{ text: string; seconds?: number }> {
    const mime = audio.mime.split(";")[0]!.trim().toLowerCase();
    const model = this.cfg.model ?? "whisper-1";
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio.data)], { type: mime }), `audio.${EXTENSIONS[mime] ?? "ogg"}`);
    form.append("model", model);
    form.append("language", language.slice(0, 2));
    // Sólo los modelos Whisper informan la duración (verbose_json).
    form.append("response_format", /whisper/i.test(model) ? "verbose_json" : "json");
    const res = await this.fetchFn(`${(this.cfg.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.cfg.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`La transcripción falló (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
    const out = (await res.json()) as { text?: string; duration?: number };
    return { text: out.text ?? "", seconds: out.duration === undefined ? undefined : Math.ceil(out.duration) };
  }
}

// ---------------- Para demo y tests ----------------

/** "Transcribe" audios falsos que traen el texto adentro ("VOZ:<texto>"). */
export class FakeSpeechToText implements ISpeechToText {
  readonly id = "fake-stt";
  readonly calls: { mime: string; language: string }[] = [];

  async transcribe(audio: { data: Buffer; mime: string }, language: string): Promise<{ text: string; seconds?: number }> {
    this.calls.push({ mime: audio.mime, language });
    const text = audio.data.toString("utf8").replace(/^VOZ:/, "");
    return { text, seconds: Math.max(1, Math.round(text.split(/\s+/).length / 2.5)) };
  }
}

/** Archivos de un canal cargados a mano. */
export class FakeMediaFetcher implements IInboundMediaFetcher {
  readonly files = new Map<string, { data: Buffer; mime: string }>();

  constructor(readonly channel: ChannelType) {}

  /** Agrega una nota de voz falsa con ese texto y devuelve su id. */
  voice(text: string, id = `media-${this.files.size + 1}`): string {
    this.files.set(id, { data: Buffer.from(`VOZ:${text}`), mime: "audio/ogg" });
    return id;
  }

  /** Agrega una captura falsa con ese texto y devuelve su id. */
  image(text: string, id = `media-${this.files.size + 1}`): string {
    this.files.set(id, { data: Buffer.from(`IMG:${text}`), mime: "image/jpeg" });
    return id;
  }

  async fetch(ref: string, maxBytes: number): Promise<{ data: Buffer; mime: string }> {
    const f = this.files.get(ref);
    if (!f) throw new Error(`No existe el archivo ${ref}.`);
    if (f.data.length > maxBytes) throw new ValidationError("El audio es demasiado grande.");
    return f;
  }
}

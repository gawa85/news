import type { DomainEvent } from "../../domain/model";
import type { HttpResponse, IEventBus, IHttpClient, ILogger } from "../../domain/ports";

/** Bus de eventos en proceso. En producción: una cola (Redis Streams, SQS, RabbitMQ...). */
export class InMemoryEventBus implements IEventBus {
  private readonly handlers: ((e: DomainEvent) => Promise<void>)[] = [];
  readonly history: DomainEvent[] = [];

  constructor(private readonly logger: ILogger) {}

  subscribe(handler: (e: DomainEvent) => Promise<void>): void {
    this.handlers.push(handler);
  }

  async publish(event: DomainEvent): Promise<void> {
    this.history.push(event);
    // Un suscriptor que falla no afecta al que publicó ni a los demás.
    await Promise.all(
      this.handlers.map((h) => h(event).catch((err) => this.logger.warn("Falló un suscriptor de eventos", { type: event.type, error: String(err) }))),
    );
  }
}

/** Cliente HTTP real con fetch y tiempo límite. */
export class FetchHttpClient implements IHttpClient {
  constructor(private readonly timeoutMs = 15_000) {}

  get(url: string, headers: Record<string, string> = {}): Promise<HttpResponse> {
    return this.request("GET", url, undefined, headers);
  }

  send(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body: unknown, headers: Record<string, string> = {}): Promise<HttpResponse> {
    return this.request(method, url, body, headers);
  }

  private async request(method: string, url: string, body: unknown, headers: Record<string, string>): Promise<HttpResponse> {
    const isString = typeof body === "string";
    const res = await fetch(url, {
      method,
      headers: { ...(body !== undefined && !isString ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : isString ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return { status: res.status, text: await res.text(), headers: Object.fromEntries(res.headers.entries()) };
  }
}

/** Para tests: respuestas preparadas por URL y registro de pedidos. */
export class StubHttpClient implements IHttpClient {
  readonly requests: { method: string; url: string; body?: unknown; headers: Record<string, string> }[] = [];

  constructor(private readonly handler: (method: string, url: string, body?: unknown) => Partial<HttpResponse> & { status: number }) {}

  async get(url: string, headers: Record<string, string> = {}): Promise<HttpResponse> {
    this.requests.push({ method: "GET", url, headers });
    return { text: "", headers: {}, ...this.handler("GET", url) };
  }

  async send(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body: unknown, headers: Record<string, string> = {}): Promise<HttpResponse> {
    this.requests.push({ method, url, body, headers });
    return { text: "", headers: {}, ...this.handler(method, url, body) };
  }
}

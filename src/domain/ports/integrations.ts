import type { ApiKey, DomainEvent, DomainEventType, WebhookSubscription } from "../model";

export interface IApiKeyRepository {
  findByHash(hash: string): Promise<ApiKey | undefined>;
  findByUser(userId: string): Promise<ApiKey[]>;
  save(key: ApiKey): Promise<void>;
}

export interface IWebhookRepository {
  findActiveForEvent(userId: string, event: DomainEventType): Promise<WebhookSubscription[]>;
  findByUser(userId: string): Promise<WebhookSubscription[]>;
  save(sub: WebhookSubscription): Promise<void>;
}

/** Bus de eventos del dominio: quien produce no conoce a quien escucha. */
export interface IEventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(handler: (event: DomainEvent) => Promise<void>): void;
}

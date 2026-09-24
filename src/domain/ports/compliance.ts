import type { DeliveryAttempt, DestinationHealth, OptOut, PlatformPolicy } from "../model";

export interface IPlatformPolicyRegistry {
  policyFor(destination: string): PlatformPolicy;
}

export interface IDeliveryLog {
  record(attempt: DeliveryAttempt): Promise<void>;
  countSent(destination: string, since: Date, recipientHash?: string): Promise<number>;
  lastSent(destination: string, recipientHash: string): Promise<Date | undefined>;
  deleteOlderThan(date: Date): Promise<void>;
}

export interface IDestinationHealthRepository {
  get(destination: string): Promise<DestinationHealth | undefined>;
  save(health: DestinationHealth): Promise<void>;
}

export interface IOptOutRepository {
  isOptedOut(channel: string, address: string): Promise<boolean>;
  save(optOut: OptOut): Promise<void>;
  remove(channel: string, address: string): Promise<void>;
}

/** Último mensaje ENTRANTE de cada persona (para ventanas de conversación como la de WhatsApp). */
export interface IConversationWindowRepository {
  touch(channel: string, address: string, at: Date): Promise<void>;
  lastInbound(channel: string, address: string): Promise<Date | undefined>;
}

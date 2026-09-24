import type { PlatformPolicy } from "../../domain/model";
import type { IPlatformPolicyRegistry } from "../../domain/ports";

/**
 * Políticas por destino, con comodín: "discourse:*" vale para cualquier foro Discourse
 * salvo que haya una política más específica ("discourse:foro.example").
 */
export class StaticPolicyRegistry implements IPlatformPolicyRegistry {
  constructor(
    private readonly policies: PlatformPolicy[],
    private readonly fallback: Omit<PlatformPolicy, "destination">,
  ) {}

  policyFor(destination: string): PlatformPolicy {
    const exact = this.policies.find((p) => p.destination === destination);
    if (exact) return exact;
    const kind = destination.split(":")[0];
    const wildcard = this.policies.find((p) => p.destination === `${kind}:*`);
    return wildcard ? { ...wildcard, destination } : { ...this.fallback, destination };
  }
}

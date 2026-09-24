import type { ActionDefinition, ActionId } from "../../domain/model";

/**
 * Qué exige cada acción del producto. Es la tabla que une ROLES (permiso)
 * con PLANES (funcionalidad) y USO (métrica que consume cuota).
 */
export const ACTIONS: Record<ActionId, ActionDefinition> = {
  analyze_smoke: { id: "analyze_smoke", permission: "smoke:analyze", feature: "smoke_analysis", metric: "analyses" },
  analyze_content: { id: "analyze_content", permission: "content:analyze", feature: "content_analysis", metric: "analyses" },
  compare_sources: { id: "compare_sources", permission: "sources:compare", feature: "source_comparison", metric: "comparisons" },
  trace_origin: { id: "trace_origin", permission: "origin:trace", feature: "origin_trace", metric: "analyses" },
  evaluate_credibility: { id: "evaluate_credibility", permission: "credibility:view", feature: "credibility_meter", metric: "analyses" },
  credibility_timeline: { id: "credibility_timeline", permission: "credibility:timeline", feature: "credibility_timeline", metric: "analyses" },
};

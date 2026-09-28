import { useApi } from "../../api/ApiContext";
import type { CategoryNode, Outlet } from "../../api/types";
import { useAsync } from "../../ui/useAsync";

/** Todos los temas (de todas las categorías), para sugerir al escribir. */
export function flattenTopics(tree: CategoryNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: CategoryNode[]) => nodes.forEach((n) => (out.push(...n.topics.map((t) => t.name)), walk(n.children)));
  walk(tree);
  return [...new Set(out)].sort((a, b) => a.localeCompare(b, "es"));
}

export function useTopics() {
  const api = useApi();
  const r = useAsync(() => api.topics(), [api]);
  return r.data ? flattenTopics(r.data) : [];
}

/** Nombre de cada tema por id (las preferencias guardan ids). */
export function useTopicNames() {
  const api = useApi();
  const r = useAsync(() => api.topics(), [api]);
  const names = new Map<string, string>();
  const walk = (nodes: CategoryNode[]) => nodes.forEach((n) => (n.topics.forEach((t) => names.set(t.id, t.name)), walk(n.children)));
  walk(r.data ?? []);
  return { names, all: [...new Set(names.values())].sort((a, b) => a.localeCompare(b, "es")) };
}

export function useOutlets() {
  const api = useApi();
  const r = useAsync(() => api.outlets(), [api]);
  const list: Outlet[] = r.data ?? [];
  return { list, nameOf: (id: string) => list.find((o) => o.id === id)?.name ?? id.replace(/^web:/, "") };
}

/** Sugerencias para un campo de texto (datalist: accesible y sin librerías). */
export function TopicSuggestions({ id, topics }: { id: string; topics: string[] }) {
  return (
    <datalist id={id}>
      {topics.map((t) => (
        <option key={t} value={t} />
      ))}
    </datalist>
  );
}

/** Fecha de hoy menos `days`, como "AAAA-MM-DD" (para <input type="date">). */
export const isoDay = (daysAgo = 0) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

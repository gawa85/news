import { useState } from "react";
import type { DirectoryCategory, DirectoryEntry } from "../../api/types";
import { OUTLET_KIND_LABELS } from "../../domain/labels";
import { Field } from "../../ui/components";

export const CATEGORY_LABELS: Record<DirectoryCategory, string> = {
  nacional: "Nacionales",
  agencia: "Agencias de noticias",
  verificador: "Verificadores de datos",
  oficial: "Oficiales",
  internacional: "Internacionales en castellano",
  provincial: "Provinciales",
};
const CATEGORIES = Object.keys(CATEGORY_LABELS) as DirectoryCategory[];
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Elegir fuentes del directorio de fuentes públicas conocidas: filtrar por tipo, provincia o
 * nombre, marcar varias y agregarlas de una vez. Las que ya están aparecen marcadas y no se eligen.
 */
export function DirectoryPicker({
  entries,
  isAdded,
  addedLabel,
  room,
  submitLabel,
  pending,
  onSubmit,
}: {
  entries: DirectoryEntry[];
  isAdded: (e: DirectoryEntry) => boolean;
  /** Cómo se llama "ya está" en esta pantalla ("Ya la tenés", "En el catálogo"). */
  addedLabel: string;
  /** Cuántas se pueden agregar todavía (null = sin límite). */
  room: number | null;
  submitLabel: string;
  pending: boolean;
  onSubmit: (ids: string[]) => void;
}) {
  const [category, setCategory] = useState<DirectoryCategory | "todas">("todas");
  const [province, setProvince] = useState("");
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const provinces = [...new Set(entries.map((e) => e.province).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b, "es"));
  const needle = norm(q.trim());
  const shown = entries.filter(
    (e) =>
      (category === "todas" || e.category === category) &&
      (!province || e.province === province) &&
      (!needle || norm(`${e.name} ${e.description} ${e.province ?? ""}`).includes(needle)),
  );
  const full = room !== null && chosen.length >= room;
  const toggle = (id: string, on: boolean) => setChosen(on ? [...chosen, id] : chosen.filter((x) => x !== id));
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: "wrap" }} role="group" aria-label="Tipo de fuente">
        {(["todas", ...CATEGORIES] as const).map((c) => (
          <button key={c} type="button" className="btn btn--ghost btn--small" aria-pressed={category === c} onClick={() => setCategory(c)}>
            {c === "todas" ? "Todas" : CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      <div className="grid-2">
        <Field label="Buscar por nombre">{(p) => <input {...p} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        <Field label="Provincia">
          {(p) => (
            <select {...p} className="input" value={province} onChange={(e) => setProvince(e.target.value)}>
              <option value="">(todas)</option>
              {provinces.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <p className="muted" role="status" style={{ margin: 0 }}>
        {shown.length} fuente(s) · elegiste {chosen.length}
        {room !== null && ` · te quedan ${Math.max(0, room - chosen.length)} lugar(es)`}
      </p>
      <ul className="plain-list directory-list">
        {shown.map((e) => {
          const added = isAdded(e);
          const on = chosen.includes(e.id);
          return (
            <li key={e.id}>
              <label className="row directory-item">
                <input type="checkbox" checked={added || on} disabled={added || pending || (full && !on)} onChange={(ev) => toggle(e.id, ev.target.checked)} />
                <span>
                  <strong>{e.name}</strong> {added && <span className="badge badge--fact">{addedLabel}</span>}
                  <br />
                  <span className="muted">
                    {e.description} {OUTLET_KIND_LABELS[e.kind] ? `· ${OUTLET_KIND_LABELS[e.kind]}` : ""}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className="muted">Ninguna coincide con el filtro.</p>}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn btn--small" type="button" disabled={pending || chosen.length === 0} onClick={() => onSubmit(chosen)}>
          {pending ? "Agregando…" : `${submitLabel} (${chosen.length})`}
        </button>
        {chosen.length > 0 && (
          <button className="btn btn--ghost btn--small" type="button" disabled={pending} onClick={() => setChosen([])}>
            Desmarcar todas
          </button>
        )}
      </div>
    </div>
  );
}

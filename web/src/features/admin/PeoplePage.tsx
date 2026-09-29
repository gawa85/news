import { useState, type FormEvent } from "react";
import { useBackoffice } from "../../api/BackofficeContext";
import type { AdminUser, RoleInfo, UserListFilter } from "../../api/backofficeTypes";
import { CHANNEL_NAMES, formatDate, formatDateTime } from "../../domain/labels";
import { ErrorAlert, Field, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";
import { useOutlets } from "../shared/catalog";

const MIN_REASON = 10;

/**
 * PERSONAS: buscar una cuenta por mail, teléfono o id; darle roles del equipo, acreditarla como
 * representante de un medio o suspenderla. Todo cambio queda en la auditoría.
 */
export function PeoplePage() {
  const api = useBackoffice();
  const roles = useAsync(() => api.roleCatalog(), [api]);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState({ q: "", filter: "staff" as UserListFilter });
  const list = useAsync(() => api.searchUsers(query.q, query.filter), [api, query]);
  const [selected, setSelected] = useState<string>();
  const roleName = (id: string) => roles.data?.find((r) => r.id === id)?.name ?? id;
  const replace = (u: AdminUser) => list.setData((list.data ?? []).map((x) => (x.id === u.id ? u : x)));
  const person = list.data?.find((u) => u.id === selected);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSelected(undefined);
    setQuery({ ...query, q });
  };
  const show = (filter: UserListFilter) => {
    setQ("");
    setSelected(undefined);
    setQuery({ q: "", filter });
  };
  return (
    <Page title="Personas" lead="Se busca por dato exacto: no hay búsqueda por nombre, para no recorrer datos personales de nadie.">
      <form className="card stack" onSubmit={submit} role="search" noValidate>
        <Field label="Mail, teléfono o id de la cuenta">{(p) => <input {...p} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button className="btn btn--small" type="submit" disabled={!q.trim()}>
            Buscar
          </button>
          <button className="btn btn--ghost btn--small" type="button" aria-pressed={!query.q && query.filter === "staff"} onClick={() => show("staff")}>
            Ver el equipo de la plataforma
          </button>
          <button className="btn btn--ghost btn--small" type="button" aria-pressed={!query.q && query.filter === "suspended"} onClick={() => show("suspended")}>
            Ver las suspendidas
          </button>
        </div>
      </form>
      {list.loading && <Spinner />}
      <ErrorAlert error={list.error ?? roles.error} />
      {list.data && list.data.length === 0 && <p className="muted">{query.q ? "No hay ninguna cuenta con ese dato." : "No hay cuentas en esta lista."}</p>}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap card" role="region" aria-label="Cuentas encontradas (se desplaza de costado)" tabIndex={0}>
          <table className="table">
            <caption className="visually-hidden">Cuentas encontradas</caption>
            <thead>
              <tr>
                <th scope="col">Persona</th>
                <th scope="col">Roles</th>
                <th scope="col">Estado</th>
                <th scope="col">
                  <span className="visually-hidden">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((u) => (
                <tr key={u.id}>
                  <th scope="row">
                    {u.name}
                    <br />
                    <span className="muted">{u.channels.map((c) => c.address).join(" · ") || "Sin contacto"}</span>
                  </th>
                  <td>{u.roleIds.map(roleName).join(", ")}</td>
                  <td>
                    <StatusBadge u={u} />
                  </td>
                  <td>
                    <button className="btn btn--ghost btn--small" type="button" aria-label={`Gestionar a ${u.name}`} aria-expanded={selected === u.id} onClick={() => setSelected(selected === u.id ? undefined : u.id)}>
                      {selected === u.id ? "Cerrar" : "Gestionar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {person && roles.data && <PersonCard key={person.id} u={person} roles={roles.data} onChange={replace} />}
    </Page>
  );
}

function StatusBadge({ u }: { u: AdminUser }) {
  return u.status === "active" ? <span className="badge badge--fact">Activa</span> : <span className="badge badge--danger">Suspendida</span>;
}

function PersonCard({ u, roles, onChange }: { u: AdminUser; roles: RoleInfo[]; onChange: (u: AdminUser) => void }) {
  return (
    <section className="card stack" aria-labelledby="persona-elegida">
      <h2 id="persona-elegida">
        {u.name} <StatusBadge u={u} />
      </h2>
      <p className="muted" style={{ margin: 0 }}>
        Cuenta <span className="mono">{u.id}</span> · desde el {formatDate(u.createdAt)}
        {u.organization && ` · Organización: ${u.organization.name}`}
      </p>
      {u.channels.length > 0 && (
        <ul>
          {u.channels.map((c) => (
            <li key={`${c.channel}:${c.address}`}>
              {CHANNEL_NAMES[c.channel] ?? c.channel}: {c.address}
              {!c.verified && " (sin verificar)"}
            </li>
          ))}
        </ul>
      )}
      <RolesSection u={u} roles={roles} onChange={onChange} />
      <OutletsSection u={u} onChange={onChange} />
      <SuspensionSection u={u} onChange={onChange} />
    </section>
  );
}

function RolesSection({ u, roles, onChange }: { u: AdminUser; roles: RoleInfo[]; onChange: (u: AdminUser) => void }) {
  const api = useBackoffice();
  const available = roles.filter((r) => !u.roleIds.includes(r.id) && r.id !== "outlet_rep");
  const [roleId, setRoleId] = useState(available[0]?.id ?? "");
  const add = useAction(async () => onChange(await api.addUserRole(u.id, roleId)));
  const remove = useAction(async (id: string) => onChange(await api.removeUserRole(u.id, id)));
  const name = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  return (
    <div className="stack">
      <h3 style={{ margin: 0 }}>Roles</h3>
      <ul className="plain-list stack">
        {u.roleIds.map((id) => (
          <li key={id} className="row" style={{ justifyContent: "space-between" }}>
            <span>
              {name(id)}
              <span className="muted"> — {roles.find((r) => r.id === id)?.description}</span>
            </span>
            {id !== "outlet_rep" && (
              <button className="btn btn--ghost btn--small" type="button" aria-label={`Quitar el rol ${name(id)} a ${u.name}`} disabled={remove.pending} onClick={() => void remove.run(id)}>
                Quitar
              </button>
            )}
          </li>
        ))}
      </ul>
      {u.status === "active" && available.length > 0 && (
        <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="Rol para agregar">
            {(p) => (
              <select {...p} className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                {available.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.scope === "platform" ? " (equipo de la plataforma)" : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button className="btn btn--small" type="button" disabled={add.pending || !roleId} onClick={() => void add.run()}>
            Dar el rol
          </button>
        </div>
      )}
      <ErrorAlert error={add.error ?? remove.error} />
    </div>
  );
}

function OutletsSection({ u, onChange }: { u: AdminUser; onChange: (u: AdminUser) => void }) {
  const api = useBackoffice();
  const { list, nameOf } = useOutlets();
  const options = list.filter((o) => !u.representsOutletIds.includes(o.id));
  const [outletId, setOutletId] = useState("");
  const add = useAction(async () => {
    onChange(await api.addRepresentedOutlet(u.id, outletId || options[0]!.id));
    setOutletId("");
  });
  const remove = useAction(async (id: string) => onChange(await api.removeRepresentedOutlet(u.id, id)));
  return (
    <div className="stack">
      <h3 style={{ margin: 0 }}>Medios que representa</h3>
      <p className="muted" style={{ margin: 0 }}>
        Quien representa a un medio puede pedir réplica sobre sus evaluaciones (y no verifica notas de ese medio).
      </p>
      {u.representsOutletIds.length === 0 ? (
        <p className="muted">Ninguno.</p>
      ) : (
        <ul className="plain-list stack">
          {u.representsOutletIds.map((id) => (
            <li key={id} className="row" style={{ justifyContent: "space-between" }}>
              <span>{nameOf(id)}</span>
              <button className="btn btn--ghost btn--small" type="button" aria-label={`Dejar de acreditar a ${u.name} por ${nameOf(id)}`} disabled={remove.pending} onClick={() => void remove.run(id)}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      {u.status === "active" && options.length > 0 && (
        <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="Medio">
            {(p) => (
              <select {...p} className="input" value={outletId || options[0]!.id} onChange={(e) => setOutletId(e.target.value)}>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button className="btn btn--small" type="button" disabled={add.pending} onClick={() => void add.run()}>
            Acreditar como representante
          </button>
        </div>
      )}
      <ErrorAlert error={add.error ?? remove.error} />
    </div>
  );
}

function SuspensionSection({ u, onChange }: { u: AdminUser; onChange: (u: AdminUser) => void }) {
  const api = useBackoffice();
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const suspended = u.status === "suspended";
  const act = useAction(async () => {
    onChange(suspended ? await api.reactivateUser(u.id, reason.trim()) : await api.suspendUser(u.id, reason.trim()));
    setReason("");
    setTried(false);
  });
  const ok = reason.trim().length >= MIN_REASON;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (ok) void act.run();
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <h3 style={{ margin: 0 }}>{suspended ? "Cuenta suspendida" : "Suspender la cuenta"}</h3>
      {suspended && u.suspension ? (
        <p style={{ margin: 0 }}>
          Desde el {formatDateTime(u.suspension.at)}: «{u.suspension.reason}».
        </p>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Cierra todas sus sesiones al instante. Deja de poder usar la web, las claves de API y el chat hasta que se reactive.
        </p>
      )}
      <Field label={suspended ? "Motivo para reactivarla" : "Motivo de la suspensión"} hint="Queda en la auditoría." error={tried && !ok ? `Explicá el motivo (al menos ${MIN_REASON} caracteres).` : undefined}>
        {(p) => <textarea {...p} className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <div className="row">
        <button className={suspended ? "btn btn--small" : "btn btn--danger btn--small"} type="submit" disabled={act.pending}>
          {suspended ? "Reactivar la cuenta" : "Suspender la cuenta"}
        </button>
      </div>
      <ErrorAlert error={act.error} />
    </form>
  );
}

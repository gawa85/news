import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { OrganizationOverview } from "../../api/types";
import { formatDate } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

/** MI ORGANIZACIÓN: sin organización, crearla; con una, el equipo (y, si administro, invitar y roles). */
export function OrganizationPage() {
  const api = useApi();
  const org = useAsync(() => api.organization(), [api]);
  // Al recargar (después de invitar) se sigue mostrando lo que había: no se pierden los avisos.
  if (org.loading && !org.data) return <div className="page"><Spinner /></div>;
  if (org.error && !org.data) return <Page title="Mi organización"><ErrorAlert error={org.error} /></Page>;
  if (!org.data) return <CreateOrganization onCreated={(o) => org.setData(o)} />;
  return <Team o={org.data} onChange={(o) => org.setData(o)} reload={() => void org.reload()} />;
}

function CreateOrganization({ onCreated }: { onCreated: (o: OrganizationOverview) => void }) {
  const api = useApi();
  const { refresh } = useSession();
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const create = useAction(async () => {
    const o = await api.createOrganization(name.trim());
    await refresh(); // cambia el plan (el del equipo)
    onCreated(o);
    return o;
  });
  const error = touched && name.trim().length < 3 ? "Escribí el nombre (al menos 3 letras)." : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (name.trim().length >= 3) void create.run();
  };
  return (
    <Page title="Mi organización" lead="Para medios, consultoras, ONG y escuelas: un plan para todo el equipo, roles, salas en vivo y reglas comunes.">
      <form className="card stack" onSubmit={submit} noValidate aria-labelledby="crear-org">
        <h2 id="crear-org">Crear una organización</h2>
        <p className="muted">Arranca con 14 días de prueba del plan Equipo. Vos quedás como administrador y después invitás al resto.</p>
        <Field label="Nombre de la organización" error={error}>
          {(p) => <input {...p} className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="row">
          <button className="btn" type="submit" disabled={create.pending}>
            {create.pending ? "Creando…" : "Crear organización"}
          </button>
        </div>
        <ErrorAlert error={create.error} />
      </form>
      <p className="muted">¿Te invitaron a un equipo? Abrí el enlace que te llegó por mail.</p>
    </Page>
  );
}

function Team({ o, onChange, reload }: { o: OrganizationOverview; onChange: (o: OrganizationOverview) => void; reload: () => void }) {
  const roleName = (id: string) => o.roles.find((r) => r.id === id)?.name ?? ROLE_NAMES[id] ?? id;
  const full = o.seats.limit !== null && o.seats.used >= o.seats.limit;
  return (
    <Page title={o.organization.name} lead={`Plan ${o.plan.name} · ${o.seats.used} de ${o.seats.limit ?? "∞"} lugares ocupados (contando invitaciones pendientes).`}>
      {o.canManage && (full ? (
        <Notice title="No quedan lugares">
          <p>
            Para sumar más personas, liberá un lugar o <Link to="/planes">pasá a un plan con más lugares</Link>.
          </p>
        </Notice>
      ) : (
        <Invite o={o} onInvited={reload} />
      ))}

      <section className="card stack" aria-labelledby="equipo">
        <h2 id="equipo">Equipo</h2>
        <ul className="plain-list stack">
          {[...o.members].sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name, "es")).map((m) => (
            <Member key={m.id} o={o} m={m} roleName={roleName} onChange={onChange} />
          ))}
        </ul>
      </section>

      {o.canManage && o.invitations.length > 0 && <Pending o={o} roleName={roleName} onRevoked={reload} />}
      <Leave />
    </Page>
  );
}

/** Nombres de roles para quien no administra (no recibe la lista de roles asignables). */
const ROLE_NAMES: Record<string, string> = { org_admin: "Administrador", reader: "Lector", analyst: "Analista", moderator: "Moderador", teacher: "Docente" };

function Invite({ o, onInvited }: { o: OrganizationOverview; onInvited: () => void }) {
  const api = useApi();
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(o.roles.some((r) => r.id === "reader") ? "reader" : (o.roles[0]?.id ?? ""));
  const [touched, setTouched] = useState(false);
  const [sentTo, setSentTo] = useState<string>();
  const invite = useAction(async () => {
    await api.inviteMember(email.trim(), roleId);
    setSentTo(email.trim());
    setEmail("");
    setTouched(false);
    onInvited();
  });
  const error = touched && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? "Escribí un mail válido." : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setSentTo(undefined);
    if (!error && email.trim()) void invite.run();
  };
  const role = o.roles.find((r) => r.id === roleId);
  return (
    <form className="card stack" onSubmit={submit} noValidate aria-labelledby="invitar">
      <h2 id="invitar">Invitar a alguien</h2>
      <div className="grid-2">
        <Field label="Mail" error={error}>
          {(p) => <input {...p} className="input" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Rol" hint={role?.description}>
          {(p) => (
            <select {...p} className="select" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {o.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <p className="muted">Le llega un enlace que vence en 7 días. Sólo lo puede usar quien entre con ese mail.</p>
      <div className="row">
        <button className="btn" type="submit" disabled={invite.pending}>
          {invite.pending ? "Invitando…" : "Mandar invitación"}
        </button>
      </div>
      <ErrorAlert error={invite.error} />
      {sentTo && !invite.pending && (
        <Notice tone="ok">
          <p>Listo: le mandamos la invitación a {sentTo}.</p>
        </Notice>
      )}
    </form>
  );
}

function Member({ o, m, roleName, onChange }: { o: OrganizationOverview; m: OrganizationOverview["members"][number]; roleName: (id: string) => string; onChange: (o: OrganizationOverview) => void }) {
  const api = useApi();
  const orgRole = m.roleIds.find((r) => o.roles.some((x) => x.id === r) || ROLE_NAMES[r]) ?? m.roleIds[0] ?? "";
  const [confirming, setConfirming] = useState(false);
  const setRole = useAction(async (roleId: string) => onChange(await api.setMemberRole(m.id, roleId)));
  const remove = useAction(async () => onChange(await api.removeMember(m.id)));
  const editable = o.canManage && !m.isMe;
  return (
    <li className="card card--flat">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p>
            <strong>{m.name}</strong> {m.isMe && <span className="badge badge--neutral">vos</span>}
          </p>
          {m.email && <p className="muted mono">{m.email}</p>}
        </div>
        <div className="row">
          {editable ? (
            <Field label={`Rol de ${m.name}`}>
              {(p) => (
                <select {...p} className="select" value={orgRole} disabled={setRole.pending} onChange={(e) => void setRole.run(e.target.value)}>
                  {o.roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : (
            <span className="badge badge--neutral">{roleName(orgRole)}</span>
          )}
          {editable &&
            (confirming ? (
              <div className="row" role="group" aria-label={`Confirmar que sacás a ${m.name}`}>
                <button className="btn btn--danger btn--small" type="button" onClick={() => void remove.run()} disabled={remove.pending}>
                  Sí, sacar
                </button>
                <button className="btn btn--ghost btn--small" type="button" onClick={() => setConfirming(false)}>
                  No
                </button>
              </div>
            ) : (
              <button className="btn btn--ghost btn--small" type="button" onClick={() => setConfirming(true)} aria-label={`Sacar a ${m.name} del equipo`}>
                Sacar
              </button>
            ))}
        </div>
      </div>
      {confirming && <p role="status">Conserva su cuenta y su historial, con el plan Gratis.</p>}
      <ErrorAlert error={setRole.error ?? remove.error} />
    </li>
  );
}

function Pending({ o, roleName, onRevoked }: { o: OrganizationOverview; roleName: (id: string) => string; onRevoked: () => void }) {
  const api = useApi();
  const revoke = useAction(async (id: string) => {
    await api.revokeInvitation(id);
    onRevoked();
  });
  return (
    <section className="card stack" aria-labelledby="pendientes">
      <h2 id="pendientes">Invitaciones pendientes</h2>
      <ul className="plain-list stack">
        {o.invitations.map((i) => (
          <li key={i.id} className="row" style={{ justifyContent: "space-between" }}>
            <span>
              <span className="mono">{i.email}</span> · {roleName(i.roleId)} <span className="muted">· vence el {formatDate(i.expiresAt)}</span>
            </span>
            <button className="btn btn--ghost btn--small" type="button" onClick={() => void revoke.run(i.id)} disabled={revoke.pending} aria-label={`Cancelar la invitación a ${i.email}`}>
              Cancelar
            </button>
          </li>
        ))}
      </ul>
      <ErrorAlert error={revoke.error} />
    </section>
  );
}

function Leave() {
  const api = useApi();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const leave = useAction(async () => {
    await api.leaveOrganization();
    await refresh();
    navigate("/cuenta");
  });
  return (
    <section className="card stack" aria-labelledby="salir">
      <h2 id="salir">Salir de la organización</h2>
      <p className="muted">Conservás tu cuenta y tu historial; tu plan pasa a ser Gratis.</p>
      {confirming ? (
        <div className="row" role="group" aria-label="Confirmar la salida">
          <button className="btn btn--danger" type="button" onClick={() => void leave.run()} disabled={leave.pending}>
            {leave.pending ? "Saliendo…" : "Sí, salir"}
          </button>
          <button className="btn btn--ghost" type="button" onClick={() => setConfirming(false)}>
            No
          </button>
        </div>
      ) : (
        <div className="row">
          <button className="btn btn--secondary" type="button" onClick={() => setConfirming(true)}>
            Salir
          </button>
        </div>
      )}
      <ErrorAlert error={leave.error} />
    </section>
  );
}

/** UNIRME: el enlace de la invitación. Se ve de qué equipo es antes de entrar; aceptar pide sesión con ESE mail. */
export function JoinPage() {
  const api = useApi();
  const { me, refresh } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const preview = useAsync(() => api.invitation(token), [api, token]);
  const join = useAction(async () => {
    await api.joinOrganization(token);
    await refresh();
    navigate("/organizacion");
  });
  const here = `/unirme?token=${encodeURIComponent(token)}`;

  if (preview.loading) return <div className="page"><Spinner /></div>;
  if (!preview.data) {
    return (
      <Page title="Invitación" narrow>
        <ErrorAlert error={preview.error} title="No se puede usar esta invitación" />
      </Page>
    );
  }
  const inv = preview.data;
  const myEmails = (me?.channels ?? []).filter((c) => c.type === "email" && c.verified).map((c) => c.address.toLowerCase());
  return (
    <Page title={`Sumarte a ${inv.organization}`} lead={`${inv.invitedBy} te invitó al equipo de ${inv.organization} en Sin Humo.`} narrow>
      <div className="card stack">
        <p>
          La invitación es para <strong>{inv.email}</strong> y vence el {formatDate(inv.expiresAt)}.
        </p>
        {!me ? (
          <div className="row">
            <Link className="btn" to={`/entrar?next=${encodeURIComponent(here)}`}>
              Entrar con {inv.email}
            </Link>
          </div>
        ) : !myEmails.includes(inv.email) ? (
          <Notice title="Entraste con otra cuenta">
            <p>Para aceptarla, salí y entrá con {inv.email}.</p>
          </Notice>
        ) : (
          <div className="row">
            <button className="btn" type="button" onClick={() => void join.run()} disabled={join.pending}>
              {join.pending ? "Sumándote…" : "Aceptar y sumarme"}
            </button>
          </div>
        )}
        <ErrorAlert error={join.error} />
      </div>
    </Page>
  );
}

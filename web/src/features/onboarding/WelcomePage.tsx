import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { Analysis, OnboardingStatus, OnboardingStepId } from "../../api/types";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Notice, Page, SmokeMeter, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";
import { useTopicNames } from "../shared/catalog";
import { ChannelLinker } from "./ChannelLinker";

const STEPS: Record<OnboardingStepId, { title: string; lead: string }> = {
  topics: { title: "Temas que te interesan", lead: "Te avisamos cuando circula humo sobre estos temas, y el resumen semanal va por acá." },
  chat: { title: "WhatsApp o Telegram", lead: "Reenviale a Sin Humo lo que te llega y te responde ahí mismo." },
  notifications: { title: "Cómo y cuándo avisarte", lead: "Elegí si querés el resumen y en qué horario no te escribimos." },
  first_analysis: { title: "Probá un análisis", lead: "Pegá un mensaje o una nota: te mostramos qué es dato y qué es humo." },
  team: { title: "Invitá a tu equipo", lead: "Tu organización comparte el plan, las reglas y las salas." },
};

/** GUÍA DE BIENVENIDA: los primeros pasos para dejar la cuenta configurada. Todo se puede saltear. */
export function WelcomePage() {
  const api = useApi();
  const status = useAsync(() => api.onboarding(), [api]);
  const [current, setCurrent] = useState<OnboardingStepId>();
  const s = status.data;
  const open = s?.steps.filter((x) => !x.done && !x.skipped) ?? [];
  const step = current ?? open[0]?.id;
  const update = (next: OnboardingStatus) => {
    status.setData(next);
    setCurrent(undefined);
  };
  const refresh = async () => {
    setCurrent(undefined);
    await status.reload();
  };
  const skip = useAction(async (id: OnboardingStepId) => update(await api.markOnboardingStep(id, "skipped")));
  const done = s ? s.steps.filter((x) => x.done).length : 0;
  return (
    <Page title="Bienvenida" lead="Unos pasos para que Sin Humo te sirva desde hoy. Podés saltear cualquiera y volver cuando quieras." narrow>
      {status.loading && !s && <Spinner />}
      <ErrorAlert error={status.error} />
      {s && (
        <>
          <nav aria-label="Pasos de la bienvenida" className="card card--flat">
            <p style={{ margin: 0 }}>
              {done} de {s.steps.length} listos
            </p>
            <ol className="stack" style={{ margin: "var(--space-2) 0 0" }}>
              {s.steps.map((x) => (
                <li key={x.id}>
                  <button
                    className="btn btn--ghost btn--small"
                    type="button"
                    aria-current={x.id === step ? "step" : undefined}
                    onClick={() => setCurrent(x.id)}
                  >
                    {STEPS[x.id].title}
                  </button>{" "}
                  {x.done ? <span className="badge badge--fact">Listo</span> : x.skipped ? <span className="badge badge--neutral">Salteado</span> : null}
                </li>
              ))}
            </ol>
          </nav>
          {step ? (
            <section className="card stack" aria-labelledby="paso-actual">
              <h2 id="paso-actual" style={{ margin: 0 }}>
                {STEPS[step].title}
              </h2>
              <p className="muted" style={{ margin: 0 }}>
                {STEPS[step].lead}
              </p>
              {step === "topics" && <TopicsStep onDone={refresh} />}
              {step === "chat" && <ChannelLinker onChecked={() => void refresh()} />}
              {step === "notifications" && <NotificationsStep onDone={update} />}
              {step === "first_analysis" && <AnalysisStep onDone={refresh} />}
              {step === "team" && <TeamStep onDone={refresh} />}
              {!s.steps.find((x) => x.id === step)?.done && (
                <div className="row">
                  <button className="btn btn--ghost btn--small" type="button" disabled={skip.pending} onClick={() => void skip.run(step)}>
                    Saltear este paso
                  </button>
                </div>
              )}
              <ErrorAlert error={skip.error} />
            </section>
          ) : (
            <Notice tone="ok" title="¡Listo!">
              <p>
                Tu cuenta quedó configurada. Podés cambiar todo esto cuando quieras en <Link to="/cuenta">Mi cuenta</Link>.
              </p>
              <p>
                <Link to="/analizar">Ir a analizar</Link>
              </p>
            </Notice>
          )}
        </>
      )}
    </Page>
  );
}

function TopicsStep({ onDone }: { onDone: () => void }) {
  const api = useApi();
  const { names, all } = useTopicNames();
  const prefs = useAsync(() => api.preferences(), [api]);
  const followed = new Set((prefs.data?.followedTopics ?? []).map((id) => names.get(id) ?? id));
  const toggle = useAction(async (topic: string, on: boolean) => {
    await (on ? api.follow(topic) : api.unfollow(topic));
    await prefs.reload();
  });
  if (!all.length || !prefs.data) return <Spinner />;
  return (
    <div className="stack">
      <fieldset className="stack">
        <legend>Elegí uno o más</legend>
        <div className="grid-2">
          {all.map((t) => (
            <label key={t} className="row">
              <input type="checkbox" checked={followed.has(t)} disabled={toggle.pending} onChange={(e) => void toggle.run(t, e.target.checked)} />
              {t}
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorAlert error={toggle.error} />
      <div className="row">
        <button className="btn btn--small" type="button" disabled={followed.size === 0} onClick={onDone}>
          Seguir
        </button>
      </div>
    </div>
  );
}

function NotificationsStep({ onDone }: { onDone: (s: OnboardingStatus) => void }) {
  const api = useApi();
  const [digest, setDigest] = useState<"off" | "daily" | "weekly">("weekly");
  const [quiet, setQuiet] = useState(true);
  const [from, setFrom] = useState("22:00");
  const [to, setTo] = useState("08:00");
  const save = useAction(async () => {
    await api.updatePreferences({ digest, quietHours: quiet ? { from, to, utcOffsetMinutes: -180 } : null });
    onDone(await api.markOnboardingStep("notifications", "done"));
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run();
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Field label="Resumen de lo que circuló sobre tus temas">
        {(p) => (
          <select {...p} className="input" value={digest} onChange={(e) => setDigest(e.target.value as typeof digest)}>
            <option value="weekly">Una vez por semana</option>
            <option value="daily">Todos los días</option>
            <option value="off">No, gracias</option>
          </select>
        )}
      </Field>
      <label className="row">
        <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
        No escribirme de noche
      </label>
      {quiet && (
        <div className="grid-2">
          <Field label="Desde">{(p) => <input {...p} className="input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="Hasta">{(p) => <input {...p} className="input" type="time" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>
      )}
      <div className="row">
        <button className="btn btn--small" type="submit" disabled={save.pending}>
          Guardar
        </button>
      </div>
      <ErrorAlert error={save.error} />
    </form>
  );
}

const SAMPLE = "URGENTE!!! Reenviá a todos: mañana cortan el agua en todo el país, lo dijo un funcionario. Compartilo antes de que lo borren.";

function AnalysisStep({ onDone }: { onDone: () => void }) {
  const api = useApi();
  const { refresh } = useSession();
  const [text, setText] = useState(SAMPLE);
  const run = useAction(async (): Promise<Analysis> => {
    const a = await api.analyze(text.trim());
    await refresh();
    return a;
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) void run.run();
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Field label="Texto para analizar" hint="Dejamos un ejemplo: probalo o pegá uno tuyo.">
        {(p) => <textarea {...p} className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
      <div className="row">
        <button className="btn btn--small" type="submit" disabled={run.pending || !text.trim()}>
          {run.pending ? "Analizando…" : "Analizar"}
        </button>
      </div>
      <ErrorAlert error={run.error} />
      {run.result && (
        <div className="stack" role="status">
          <SmokeMeter index={run.result.smokeIndex} />
          {run.result.findings.length > 0 && <p style={{ margin: 0 }}>Encontramos {run.result.findings.length} señal(es) de humo. En Analizar ves el detalle de cada una.</p>}
          <div className="row">
            <button className="btn btn--small" type="button" onClick={onDone}>
              Seguir
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function TeamStep({ onDone }: { onDone: () => void }) {
  const api = useApi();
  const [email, setEmail] = useState("");
  const invite = useAction(async () => {
    await api.inviteMember(email.trim(), "reader");
    setEmail("");
    onDone();
  });
  const ok = /^\S+@\S+\.\S+$/.test(email.trim());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok) void invite.run();
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Field label="Mail de quien querés sumar" hint="Le llega un enlace para unirse. Los roles se cambian después en Organización.">
        {(p) => <input {...p} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <div className="row">
        <button className="btn btn--small" type="submit" disabled={invite.pending || !ok}>
          Invitar
        </button>
        <Link className="btn btn--ghost btn--small" to="/organizacion">
          Ir a Organización
        </Link>
      </div>
      <ErrorAlert error={invite.error} />
    </form>
  );
}

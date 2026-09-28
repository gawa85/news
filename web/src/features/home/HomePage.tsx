import { useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { useSession } from "../../session/SessionContext";
import { SmokeMeter } from "../../ui/components";

/** Un ejemplo real de lo que hace (estático: se entiende sin leer nada más). */
function HeroExample() {
  return (
    <figure className="card hero__example stack" style={{ margin: 0 }} aria-labelledby="ejemplo-titulo">
      <figcaption id="ejemplo-titulo" className="eyebrow">
        Ejemplo: una cadena de WhatsApp
      </figcaption>
      <blockquote style={{ margin: 0 }}>
        «<span className="strike">URGENTE!!! Reenviá a todos:</span> mañana cortan el agua en todo el país, <span className="strike">lo dijo un funcionario</span>.{" "}
        <span className="strike">Es una catástrofe histórica sin precedentes.</span>»
      </blockquote>
      <SmokeMeter index={83} />
      <ul className="plain-list">
        <li className="finding">
          <strong>Alarmismo:</strong> «urgente», «catástrofe»
        </li>
        <li className="finding">
          <strong>Afirmación sin fuente:</strong> «lo dijo un funcionario» (¿quién?)
        </li>
        <li className="finding">
          <strong>Pedido de reenvío:</strong> «reenviá a todos»
        </li>
      </ul>
    </figure>
  );
}

/** PORTADA: qué es Sin Humo. Con sesión (p. ej. al volver del enlace del mail), directo a analizar. */
export function HomePage() {
  const { me } = useSession();
  const navigate = useNavigate();
  useEffect(() => {
    document.title = "Sin Humo · Hechos, no humo";
    if (me) navigate("/analizar", { replace: true });
  }, [me, navigate]);

  return (
    <div className="page">
      <section className="hero">
        <div className="stack">
          <p className="eyebrow">Hechos, no humo</p>
          <h1 className="hero__title">Separá los hechos del humo.</h1>
          <p className="page__lead">
            Pegá una cadena, una nota o un link y te mostramos qué es dato, qué es humo y qué dicen otras fuentes. También por WhatsApp, Telegram y mail, sin instalar nada.
          </p>
          <div className="row">
            <Link className="btn" to="/entrar">
              Empezar gratis
            </Link>
            <Link className="btn btn--secondary" to="/planes">
              Ver planes
            </Link>
          </div>
        </div>
        <HeroExample />
      </section>

      <section aria-labelledby="que-hace" className="stack">
        <h2 id="que-hace">Qué hace</h2>
        <div className="grid-2">
          <div className="card">
            <h3>Detecta el humo</h3>
            <p>Adjetivos inflados, promesas vagas, alarmismo, afirmaciones sin fuente y pedidos de reenvío. Te quedás con los datos concretos.</p>
          </div>
          <div className="card">
            <h3>Compara fuentes</h3>
            <p>En qué coinciden los medios, en qué se contradicen y qué deja afuera cada uno sobre un mismo tema.</p>
          </div>
          <div className="card">
            <h3>Mide la credibilidad</h3>
            <p>Por tema y período: precisión, calidad de las fuentes, conflictos de interés de los dueños y pauta oficial.</p>
          </div>
          <div className="card">
            <h3>Lee audios, capturas y redes</h3>
            <p>Mandá una nota de voz, una captura o un link de X, TikTok o YouTube: analizamos lo que dice.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="como" className="card stack" style={{ marginTop: "var(--space-6)" }}>
        <h2 id="como">Sin humo, también nosotros</h2>
        <p>
          Explicamos cada señal en palabras, mostramos la evidencia y los medios tienen derecho a réplica. Tus datos no se venden y los podés bajar o borrar cuando quieras.
        </p>
      </section>
    </div>
  );
}

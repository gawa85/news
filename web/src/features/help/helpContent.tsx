import type { ReactNode } from "react";

/** Ayuda de una pantalla: para qué sirve, cómo se usa, un ejemplo y las palabras que conviene conocer. */
export interface PageHelpContent {
  summary: string;
  steps?: ReactNode[];
  example?: ReactNode;
  /** Ids del glosario. */
  terms?: string[];
}

/**
 * AYUDA DE CADA PANTALLA, por dirección. Lenguaje simple y ejemplos concretos: la puede leer
 * alguien que entra por primera vez.
 */
export const PAGE_HELP: Record<string, PageHelpContent> = {
  // ---- Para todas las personas ----
  "/analizar": {
    summary: "Pegás un texto (un mensaje que te llegó, una cadena, una nota) o el link de una nota o una publicación, y Sin Humo marca qué partes son datos y cuáles son humo.",
    steps: [
      "Copiá el mensaje o el link y pegalo en el cuadro.",
      "Tocá «Analizar».",
      "Mirá el índice de humo, qué humo encontró (con la frase exacta) y «Lo que queda sin humo»: el mismo texto sólo con los datos.",
    ],
    example: "«URGENTE!!! Reenviá a todos: mañana cortan el agua en todo el país» → índice alto: alarma sin fuente y pedido de reenvío.",
    terms: ["humo", "indice_humo"],
  },
  "/historial": { summary: "Todo lo que analizaste, por la web, WhatsApp, Telegram o mail, y lo que trajeron tus fuentes conectadas. Debajo de cada uno dice de dónde vino. Tocá uno para ver el resultado completo y el link al original." },
  "/comparar": {
    summary: "Elegís un tema y unas fechas, y ves qué dijeron distintos medios: en qué coinciden, en qué se contradicen y qué deja afuera cada uno.",
    steps: ["Escribí un tema (te sugerimos los que existen).", "Elegí desde y hasta cuándo.", "Tocá «Comparar»."],
    example: "Tema «tarifas de gas», último mes: un medio dice que el aumento es de 30 % y otro de 18 %; eso aparece como contradicción.",
    terms: ["tema", "credibilidad"],
  },
  "/origen": {
    summary: "Pegás el link de una nota y buscamos quién publicó primero lo mismo, y cuántas notas son casi copia de la misma gacetilla.",
    example: "Diez medios con el mismo texto en la misma hora suelen venir de una gacetilla: vale la pena buscar la fuente original.",
    terms: ["gacetilla"],
  },
  "/credibilidad": {
    summary: "Cuánto confiar en un medio sobre un tema: si lo que publicó se comprobó, si otros medios dan las mismas cifras, si cita fuentes, cuánto humo tiene, sus dueños y la pauta oficial. Que una nota traiga datos no quiere decir que sean ciertos: sin datos corroborados no hay puntaje general.",
    steps: ["Elegí un medio.", "Elegí un tema.", "Mirá el estado (verificado, cotejado o sin corroborar) y, sobre todo, por qué: cada dimensión dice de dónde sale."],
    example: "«Sin corroborar» no quiere decir que el medio mienta: quiere decir que todavía nadie comprobó sus datos.",
    terms: ["credibilidad", "corroborar", "cotejo", "indice_humo", "pauta_oficial", "replica"],
  },
  "/credibilidad/panorama": {
    summary: "Todos los medios juntos: cuánto de lo que publica cada uno está corroborado, y los datos que más se repiten entre medios sin que nadie los haya verificado.",
    steps: ["Elegí un tema (o dejalo vacío para ver todos) y el período.", "Compará los medios: el estado dice si hay con qué respaldar el puntaje.", "Mirá «Datos repetidos que nadie verificó»: por ahí conviene empezar a corroborar.", "En cada dato: «Qué dijo cada medio» (con la nota), «Buscar información» (Google, Chequeado, datos oficiales), «Analizar el texto» y «¿Quién lo dijo primero?».", "Si sos del equipo de verificación, «Verificar acá»: se crea la tarea, buscás en fuentes oficiales, cargás la evidencia con su link y marcás si es cierto, falso o está en disputa."],
    example: "Si cinco medios dicen «la inflación fue 2,1 %», no por eso es cierto: puede que todos hayan copiado el mismo cable. Hay que ir a la fuente (el INDEC).",
    terms: ["corroborar", "cotejo", "credibilidad"],
  },
  "/revisar": {
    summary: "Subís una foto o un video y te decimos si ya circuló antes (y cuándo) y qué dicen sus datos internos: fecha, programa con que se editó, marcas de inteligencia artificial. Un video se reconoce aunque lo hayan reenviado por WhatsApp (que lo recomprime) o le hayan cortado una parte, y una foto que es una captura de un video también.",
    example: "Una foto «de hoy» que ya había circulado en 2019, o un video «de anoche» con las mismas escenas que uno de hace dos años, son señales fuertes de que los usan fuera de contexto.",
  },
  "/fuentes": {
    summary: "Conectás tu buzón de mail o los feeds que seguís, y lo nuevo se analiza solo: te avisamos si hay humo.",
    steps: [
      "Lo más rápido: en «Fuentes sugeridas», filtrá por tipo o provincia, marcá las que quieras y tocá «Agregar las elegidas».",
      "Para otra fuente: elegí qué conectar (un feed o un buzón de mail) y pegá su dirección o los datos del buzón.",
      "Listo: se revisa sola cada 15 minutos y te avisamos si llega humo. Si querés ver algo ya, tocá «Leer ahora» en la fuente (una vez por minuto).",
    ],
    example: "Feed de un medio: https://www.ejemplo.com.ar/rss",
    terms: ["feed", "imap"],
  },
  "/reglas": {
    summary: "Qué medios usar cuando comparás noticias: podés excluir los que no querés o limitarte a una lista.",
    example: "Excluir «*.ejemplo.com» deja afuera todas las notas de ese sitio.",
  },
  "/replica": { summary: "Si representás a un medio y creés que lo evaluamos mal, contanos por qué y con qué pruebas. La resuelve otra persona del equipo y la respuesta se publica.", terms: ["replica", "fe_erratas"] },
  "/alertas": {
    summary: "Te avisamos por tu canal cuando pasa algo en un tema que seguís: humo nuevo circulando, cobertura nueva o un cambio en la credibilidad de un medio.",
    steps: ["Elegí el tema.", "Elegí qué tiene que pasar para avisarte.", "Elegí por dónde (WhatsApp, Telegram o mail)."],
  },
  "/estadisticas": { summary: "Qué se analizó, cuánto humo había, de qué tipo y por dónde llegó, por día, semana o mes. Se pueden descargar y recibir por mail.", terms: ["humo"] },
  "/salas/*": {
    summary: "Una sala en vivo del equipo: los mensajes aparecen al instante. Quien modera puede publicar chequeos (quedan fijados arriba) y borrar mensajes.",
    example: "Durante un debate, el equipo comenta en la sala y publica un chequeo cuando alguien dice una cifra dudosa.",
    terms: ["sala", "organizacion"],
  },
  "/salas": { summary: "Chats en vivo de tu organización para seguir un tema juntos, con chequeos.", terms: ["sala", "organizacion"] },
  "/organizacion": { summary: "Tu equipo: quiénes están, con qué rol, cuántos lugares quedan en el plan, e invitaciones.", terms: ["organizacion", "rol", "plan"] },
  "/marca": { summary: "Que las respuestas y los mails salgan con el nombre, logo y color de tu organización, y desde tu dominio.", terms: ["marca_propia", "dominio", "registro_txt"] },
  "/aulas": { summary: "Grupos del modo aprendizaje: compartís un código con tus estudiantes y ves su progreso por apodo, sin datos de contacto.", terms: ["aula"] },
  "/respuestas": { summary: "Respuestas públicas en foros y páginas en nombre de la organización. Las que tienen riesgo las revisa otra persona antes de publicarse.", terms: ["respuesta_publica", "cuatro_ojos"] },
  "/campanas": { summary: "Acciones coordinadas para responder un humo que circula. La revisa otra persona antes de lanzarse y después ves su impacto.", terms: ["campana", "cuatro_ojos"] },
  "/archivo": { summary: "Guardás una copia de una nota tal como está hoy, con fecha certificada. Si después la editan o la borran, queda la prueba y te avisamos.", terms: ["evidencia"] },
  "/cuenta": {
    summary: "Tus datos, tu plan, tus preferencias y las herramientas para programas (claves de API y webhooks), si tu plan las incluye.",
    terms: ["plan", "suscripcion", "clave_api", "webhook"],
  },

  // ---- Públicas (sin cuenta) ----
  "/entrar": {
    summary: "Escribís tu mail y te mandamos un enlace para entrar: no hace falta contraseña. Si no tenés cuenta, se crea sola.",
    steps: ["Escribí tu mail y tocá «Mandame el enlace».", "Abrí el mail de Sin Humo (si no está, mirá en spam).", "Tocá el enlace: entrás directo. Vence a los 15 minutos y sirve una sola vez."],
  },
  "/planes": {
    summary: "Qué incluye cada plan y cuánto cuesta. Podés empezar gratis y cambiar cuando quieras.",
    steps: ["Compará qué funciones y cuántos análisis trae cada plan.", "Elegí mensual o anual (el anual suele tener meses de regalo).", "Si tenés un cupón, lo escribís al pagar."],
    terms: ["plan", "limite", "cupon"],
  },
  "/observatorio": {
    summary: "Qué humo está circulando: las cadenas más reenviadas, los tipos de manipulación más comunes, los temas y por qué canal llegan. Son números de todas las personas juntas, sin datos de nadie.",
    example: "Si en septiembre subieron las cadenas sobre cortes de servicios, lo ves acá antes de que te llegue la próxima.",
    terms: ["humo", "cadena", "datos_abiertos"],
  },
  "/medios": {
    summary: "Quién es dueño de cada medio, cuánta pauta oficial recibe y cómo responde cuando se equivoca. Buscá un medio y tocá su nombre para ver el detalle.",
    terms: ["pauta_oficial", "credibilidad", "replica"],
  },
  "/medios/*": {
    summary: "La ficha de un medio: sus dueños (y en qué otros negocios están), la pauta oficial que recibe, sus réplicas y las correcciones que se publicaron.",
    example: "Si el dueño tiene negocios en energía, conviene leer con más atención lo que ese medio publica sobre tarifas.",
    terms: ["pauta_oficial", "replica", "fe_erratas"],
  },
  "/fe-de-erratas": { summary: "Cuando Sin Humo se equivoca, lo dice acá: qué se corrigió, cuándo y, si vino de un medio, por qué réplica.", terms: ["fe_erratas", "replica"] },
  "/datos": {
    summary: "Los números del observatorio para descargar y reusar (por ejemplo, en una nota o una investigación), en CSV o JSON. Nunca incluyen datos de personas.",
    steps: ["Elegí el conjunto de datos.", "Elegí el período.", "Descargalo en CSV (se abre con Excel o Google Sheets) o en JSON (para programas)."],
    terms: ["datos_abiertos", "csv"],
  },
  "/eventos": {
    summary: "Debates, elecciones y cadenas nacionales con chequeos en el momento. Se siguen sin cuenta; si querés, recibís los chequeos por WhatsApp o Telegram.",
  },
  "/eventos/*": {
    summary: "Un evento en vivo: arriba, los chequeos que publica el equipo (verdadero, falso, engañoso) y abajo el chat de quienes lo siguen.",
    example: "Para recibir los chequeos por tu chat, mandale a Sin Humo «/evento» y el código del evento.",
  },
  "/legal/*": { summary: "El texto vigente. Con «Otras versiones» ves las anteriores: cada vez que aceptaste unos términos, quedó registrado qué versión fue." },
  "/jugar": {
    summary: "Un juego para entrenar el ojo: te mostramos un mensaje, decidís si es humo o un dato limpio y te explicamos por qué. No hay nota: sólo práctica.",
    example: "«Científicos confirman que este té cura todo» → humo: promesa exagerada, sin decir qué científicos ni dónde se publicó.",
    terms: ["humo"],
  },
  "/ayuda": {
    summary: "Escribinos y te responde una persona del equipo. Ves tus consultas y sus respuestas acá; también podés escribir /soporte por WhatsApp o Telegram.",
  },
  "/historial/*": { summary: "El resultado completo de un análisis: de dónde vino (y el link al original), el texto, el índice de humo, qué humo encontró y lo que queda sin humo.", terms: ["humo", "indice_humo"] },

  // ---- Backoffice ----
  "/admin/puesta-en-marcha": { summary: "La lista de lo que falta para abrir Sin Humo al público. Cada punto tiene su guía paso a paso.", terms: ["https", "smtp", "cuit", "arca", "copia_seguridad"] },
  "/admin/personas": {
    summary: "Buscás una cuenta y le das o quitás roles del equipo, la acreditás como representante de un medio o la suspendés.",
    steps: ["Buscá por el mail o el teléfono exactos (no hay búsqueda por nombre).", "Tocá «Gestionar».", "Elegí el rol y tocá «Dar el rol». Suspender pide un motivo."],
    example: "Para sumar una verificadora: que entre una vez con su mail, buscala acá y dale el rol «Verificador».",
    terms: ["rol", "permiso", "auditoria"],
  },
  "/admin/soporte": { summary: "Las consultas de las personas, las urgentes y las que vencen primero arriba. Respondé, o dejá una nota interna para el equipo.", terms: ["sla"] },
  "/admin/verificacion": {
    summary: "Datos en los que los medios no coinciden. Tomás una tarea, buscás la fuente oficial (te sugerimos documentos cargados) y decidís cuál es el correcto.",
    steps: ["Tocá «Tomar» en una tarea.", "Mirá la evidencia sugerida o agregá la tuya con su link.", "Resolvé: qué afirmación es correcta y por qué."],
    terms: ["verificacion"],
  },
  "/admin/replicas": { summary: "Pedidos de los medios para que revisemos lo que dijimos de ellos. Aceptarlos (del todo o en parte) publica una fe de erratas.", terms: ["replica", "fe_erratas"] },
  "/admin/erratas": { summary: "Para corregir en público un error propio que no vino de una réplica.", terms: ["fe_erratas"] },
  "/admin/eventos": { summary: "Salas públicas para debates, elecciones o cadenas nacionales: publicás chequeos en el momento y moderás el chat." },
  "/admin/abuso": {
    summary: "Quién tiene un freno por abusar del servicio: las automáticas las pone el sistema (por ejemplo, muchos pedidos rechazados seguidos) y las manuales, el equipo.",
    example: "Si alguien del equipo quedó bloqueado por error, buscá la restricción y tocá «Levantar».",
    terms: ["restriccion", "captcha"],
  },
  "/admin/metricas": { summary: "Cuánto ingresa por mes, cuántos clientes pagan, cuántos se van y cuántos pasan del plan gratis a uno pago, en el período que elijas.", terms: ["suscripcion", "plan"] },
  "/admin/parametros": {
    summary: "Números y opciones del negocio que se cambian sin programar. Cada cambio pide un motivo y queda registrado.",
    example: "«Horas para la primera respuesta» de soporte: de 24 a 12, motivo «Sumamos una persona al equipo».",
    terms: ["parametro", "auditoria"],
  },
  "/admin/reglas": {
    summary: "Instrucciones del tipo «si pasa tal cosa, hacé tal otra», sin programar. Toda regla se prueba con ejemplos y la aprueba otra persona antes de aplicarse.",
    steps: [
      "Tocá «Nueva regla» y armá las condiciones (plan, rol, canal, hora…).",
      "Elegí el efecto: rechazar con un mensaje, limitar una cantidad o habilitar una función.",
      "Probala con escenarios («si una persona del plan Gratis escribe a las 3 de la mañana, ¿qué pasa?»).",
      "Pedile a otra persona que la apruebe.",
    ],
    example: "Promoción: si el plan es Gratis y la fecha es del 1 al 7 de diciembre, habilitar «comparar fuentes».",
    terms: ["regla_negocio", "cuatro_ojos", "borrador"],
  },
  "/admin/planes": {
    summary: "Precios, límites y funciones de cada plan; crear planes nuevos; sacar uno de la venta y mudar a sus suscriptores a otro, con aviso.",
    example: "Para subir el precio a quienes ya pagan: creá el plan nuevo copiando el viejo y mudalos con 30 días de aviso.",
    terms: ["plan", "limite", "suscripcion", "mudanza_plan"],
  },
  "/admin/legal": { summary: "Publicar una versión nueva de términos o privacidad. Las anteriores quedan, y se sabe quién aceptó cuál.", terms: ["borrador"] },
  "/admin/cupones": { summary: "Códigos de descuento: de lanzamiento, becas, convenios.", example: "BECA-PRENSA: 50 % durante 3 meses, sólo planes Personal y Profesional.", terms: ["cupon"] },
  "/admin/funciones": {
    summary: "Prender o apagar funciones sin tocar el programa, y darlas primero a una parte de las personas. Apagar una la corta enseguida para todos (sirve de freno de emergencia).",
    example: "Probar las salas en vivo con el 10 % de las personas antes de darlas a todos.",
    terms: ["funcion_prueba", "despliegue"],
  },
  "/admin/temas": {
    summary: "Los temas con los que se ordenan las notas y las palabras que los identifican. Nada se borra: se desactiva. Una nota va al tema con más palabras clave en su título y texto; si no tiene ninguna, queda en «otros».",
    steps: [
      "Si ves muchas notas en «otros», sumá el tema que falta o palabras clave a uno que ya existe.",
      "Evitá palabras cortas que son el comienzo de otras: «gol» también encuentra «golpe».",
      "Después tocá «Volver a clasificar»: las notas que ya estaban se revisan con los temas nuevos.",
    ],
    example: "Tema «tarifas de luz»: palabras clave «tarifa de luz, EDENOR, EDESUR, ENRE»; sinónimo «electricidad».",
    terms: ["tema", "palabra_clave"],
  },
  "/admin/calidad": {
    summary: "Si el algoritmo que detecta humo acierta. Se mide con ejemplos que revisó una persona; una versión nueva sólo entra en uso si mide mejor que la actual.",
    steps: [
      "Revisá los ejemplos que llegaron por «no me sirvió»: marcá si tienen humo y de qué tipo.",
      "Tocá «Medir» para ver cómo le va a la versión en uso.",
      "Si hay una candidata que mide mejor, ponela en uso.",
    ],
    terms: ["ejemplo_etiquetado", "precision", "exhaustividad", "f1", "version_algoritmo"],
  },
  "/admin/documentos": { summary: "Resoluciones, informes y comunicados oficiales. Lo que cargás aparece como evidencia sugerida al verificar.", terms: ["verificacion"] },
  "/admin/medios": {
    summary: "Los datos de cada medio y sus feeds (de donde salen sus notas nuevas). «Agregar medios conocidos» carga de una vez medios con su feed ya comprobado. Los feeds se leen solos cada 30 minutos; «Leer ahora» lee uno en el momento y «Leer todos los feeds ahora», todos en segundo plano. En «Últimas notas leídas» ves qué se trajo de cada medio y de qué tema quedó cada nota. Estas notas no van al historial de nadie: sirven para Comparar fuentes, la credibilidad de los medios y el origen de un dato.",
    terms: ["feed"],
  },
  "/admin/catalogo": {
    summary: "Cargar muchos medios, dueños o pauta oficial de una vez, desde una planilla o una fuente de datos abiertos.",
    steps: ["Armá la planilla en Excel o Google Sheets con las columnas que se indican.", "Descargala como CSV.", "Elegí qué contiene, subila y revisá el informe: qué se cargó y qué no se reconoció."],
    example: (
      <>
        Medios: <code>id,nombre,url,tipo,pais,provincia,rss</code> → <code>diario-sur,Diario Sur,https://diariosur.com.ar,digital,AR,Chubut,https://diariosur.com.ar/rss</code>
      </>
    ),
    terms: ["csv", "feed", "pauta_oficial"],
  },
  "/admin/auditoria": { summary: "Quién hizo qué y cuándo. Sirve para responder «¿quién cambió esto?». No se puede modificar.", terms: ["auditoria"] },
  "/admin/costos": { summary: "Cuánto cuesta atender a cada cliente (inteligencia artificial, mensajes, mails) frente a lo que paga, y qué proveedor cuesta más." },
  "/admin/copias": {
    summary: "Las copias de seguridad de toda la base. Hacé una y verificala: una copia sin verificar puede no servir el día que la necesites.",
    terms: ["copia_seguridad"],
  },
};

/** La ayuda de una dirección: exacta, o la de su sección con parte variable ("/medios/diario-sur" → "/medios/*"). */
export function helpFor(pathname: string): PageHelpContent | undefined {
  const path = pathname.replace(/\/$/, "") || "/";
  return PAGE_HELP[path] ?? PAGE_HELP[`${path.split("/").slice(0, 2).join("/")}/*`];
}

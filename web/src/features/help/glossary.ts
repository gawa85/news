/** Un término, en palabras simples, con un ejemplo cuando ayuda. */
export interface Term {
  term: string;
  definition: string;
  example?: string;
}

/**
 * GLOSARIO: las palabras técnicas que aparecen en Sin Humo, explicadas para quien no es técnico.
 * Lo usan la página /glosario y la ayuda de cada pantalla.
 */
export const GLOSSARY: Record<string, Term> = {
  humo: { term: "Humo", definition: "Lo que en un texto suena a información pero no lo es: exageraciones, promesas vagas, alarma sin datos, afirmaciones sin fuente o pedidos de reenviar.", example: "«¡URGENTE! Mañana cortan el agua en todo el país, reenviá» es casi todo humo: no dice quién, dónde ni por qué." },
  indice_humo: { term: "Índice de humo", definition: "Un número de 0 a 100: 0 es sólo datos y 100 es todo humo. Es una ayuda para leer con más atención, no un veredicto.", example: "Un parte de prensa con cifras y fuentes suele dar entre 0 y 20; una cadena alarmista, más de 70." },
  credibilidad: { term: "Credibilidad de un medio", definition: "Cuánto conviene confiar en un medio sobre un tema, según qué tan preciso fue, si cita fuentes, si tiene conflictos de interés y cuánta pauta oficial recibe. Cambia según el tema.", example: "Un diario puede ser muy preciso en deportes y poco en economía." },
  pauta_oficial: { term: "Pauta oficial", definition: "La publicidad que un gobierno (nacional, provincial o municipal) le paga a un medio. Se publica porque puede influir en cómo cubre a ese gobierno." },
  feed: { term: "Feed (RSS)", definition: "Una lista que publican los sitios con sus notas nuevas, pensada para que otros programas las lean solas. Sin Humo lee los feeds para enterarse de las notas nuevas de cada medio.", example: "https://www.ejemplo.com.ar/rss" },
  imap: { term: "Buzón de mail (IMAP)", definition: "La forma de conectar un buzón de mail para que Sin Humo lea los mails que llegan (por ejemplo, un newsletter) y los analice solo." },
  csv: { term: "Archivo CSV", definition: "Una planilla guardada como texto: una fila por renglón y las columnas separadas por comas. Se puede hacer con Excel o Google Sheets («Descargar como CSV»)." },
  api: { term: "API", definition: "Una puerta para que otros programas (un sistema propio, un bot, una planilla) usen Sin Humo sin pasar por la web." },
  clave_api: { term: "Clave de API", definition: "Una contraseña larga para un programa, no para una persona. Se ve una sola vez al crearla y se puede revocar en cualquier momento.", example: "sh_live_4f9a…" },
  webhook: { term: "Webhook", definition: "Un aviso automático que Sin Humo le manda a otro sistema cuando pasa algo, a una dirección de internet que vos elegís.", example: "Cada vez que se publica una respuesta, avisarle al sistema de la redacción." },
  token: { term: "Token", definition: "Una contraseña larga que da un servicio (Meta, Telegram, Mercado Pago) para que Sin Humo lo use en tu nombre. Se guarda como una contraseña." },
  rol: { term: "Rol", definition: "Lo que una persona hace en el equipo: lector, verificador, soporte, administración… Cada rol trae un conjunto de permisos." },
  permiso: { term: "Permiso", definition: "Algo puntual que una persona puede hacer (por ejemplo, «publicar fe de erratas»). No se dan sueltos: vienen con el rol." },
  plan: { term: "Plan", definition: "Lo que contrata una persona o una organización: qué funciones tiene y cuántos análisis, alertas o lugares incluye." },
  limite: { term: "Límite", definition: "Cuánto de algo incluye un plan (por ejemplo, 50 análisis por día). «Sin límite» quiere decir que no se cuenta." },
  suscripcion: { term: "Suscripción", definition: "El plan que tiene contratado alguien ahora, con su fecha de renovación y lo que paga." },
  mudanza_plan: { term: "Mudar suscriptores de plan", definition: "Pasar a todas las personas de un plan a otro en una fecha, avisando antes. Conservan lo que ya pagaron; el precio nuevo rige desde el próximo cobro." },
  cupon: { term: "Cupón", definition: "Un código de descuento que se escribe al pagar.", example: "BECA-PRENSA: 50 % durante 3 meses para periodistas." },
  funcion_prueba: { term: "Función en prueba", definition: "Una función nueva que se puede prender o apagar sin tocar el programa, y darla primero a algunas personas para probarla. Apagarla la corta enseguida para todos." },
  despliegue: { term: "Porcentaje de personas", definition: "A qué parte de las personas les llega una función en prueba. Siempre le toca a la misma persona, así no le aparece y desaparece.", example: "10 % = una de cada diez personas la ve." },
  regla_negocio: { term: "Regla del negocio", definition: "Una instrucción del tipo «si pasa tal cosa, hacé tal otra», que se arma sin programar.", example: "Si el plan es Gratis y la hora es entre 0 y 6, limitar los análisis a 3." },
  cuatro_ojos: { term: "Aprobación de otra persona", definition: "Un cambio sensible (una regla, por ejemplo) lo prepara una persona y lo aprueba otra: así nadie puede cambiar algo importante solo, por error o a propósito." },
  parametro: { term: "Parámetro", definition: "Un número u opción del negocio que se puede cambiar sin programar.", example: "Cuántas horas tiene soporte para responder por primera vez." },
  borrador: { term: "Borrador", definition: "Una versión que todavía no está aprobada o revisada. Se puede guardar y probar, pero no rige." },
  precision: { term: "Precisión", definition: "De todo lo que el algoritmo marcó como humo, cuánto lo era de verdad. Si es baja, se equivoca marcando humo donde no hay.", example: "Marcó 10 textos y 9 tenían humo: 90 %." },
  exhaustividad: { term: "Exhaustividad", definition: "De todo el humo que había, cuánto encontró. Si es baja, se le escapa humo.", example: "Había humo en 10 textos y encontró 8: 80 %." },
  f1: { term: "F1", definition: "Un solo número que combina precisión y exhaustividad: sirve para comparar versiones del algoritmo de un vistazo. Cuanto más alto, mejor." },
  ejemplo_etiquetado: { term: "Ejemplo revisado", definition: "Un texto donde una persona del equipo marcó si tiene humo y de qué tipo. Con esos ejemplos se mide si el algoritmo acierta." },
  version_algoritmo: { term: "Versión del algoritmo", definition: "Cada forma de detectar humo (con reglas o con inteligencia artificial). Sólo una está en uso; otra entra en uso si mide mejor." },
  tema: { term: "Tema y categoría", definition: "Con qué asunto tiene que ver una nota (tarifas de gas, inflación…). Los temas se agrupan en categorías (Economía, Sociedad…)." },
  palabra_clave: { term: "Palabras clave y sinónimos", definition: "Las palabras que hacen que una nota se ordene en un tema. Los sinónimos son otras formas de nombrar el tema.", example: "Tema «tarifas de luz»: palabras clave «tarifa de luz, EDENOR, ENRE»; sinónimo «electricidad»." },
  replica: { term: "Derecho a réplica", definition: "Un medio evaluado puede pedir que se revise lo que se dijo de él, con sus pruebas. La resuelve otra persona del equipo y la respuesta se publica." },
  fe_erratas: { term: "Fe de erratas", definition: "Cuando Sin Humo se equivoca, lo dice en público: qué se corrigió y cuándo." },
  verificacion: { term: "Tarea de verificación", definition: "Un dato en el que dos medios no coinciden (por ejemplo, 30 % contra 18 %). Alguien del equipo busca la fuente oficial y resuelve cuál es el correcto." },
  evidencia: { term: "Copia con sello de tiempo", definition: "Una copia guardada de una nota, con la fecha y hora certificadas. Sirve de prueba si después la editan o la borran." },
  auditoria: { term: "Auditoría", definition: "El registro de quién hizo qué y cuándo. No se puede borrar ni modificar." },
  copia_seguridad: { term: "Copia de seguridad", definition: "Una copia completa de la base, cifrada. «Verificarla» es probar que se puede recuperar de verdad." },
  restriccion: { term: "Restricción", definition: "Un freno para quien abusa del servicio: pedirle un «no soy un robot» (captcha) o bloquearlo por un tiempo. Las automáticas las pone el sistema solo." },
  captcha: { term: "Captcha", definition: "La pregunta «no soy un robot» que frena a los programas que intentan abusar del servicio." },
  sla: { term: "Plazo de respuesta", definition: "Cuánto tiempo hay para responder una consulta de soporte. Si se pasa, la consulta sube de prioridad." },
  marca_propia: { term: "Marca propia", definition: "Que las respuestas y los mails salgan con el nombre, logo y color de tu organización, e incluso desde un dominio propio." },
  dominio: { term: "Dominio", definition: "La dirección de un sitio en internet.", example: "sinhumo.com.ar" },
  registro_txt: { term: "Registro TXT", definition: "Un dato que se agrega en el panel de un dominio para probar que es tuyo. Lo pide Sin Humo para usar tu dominio en la marca propia." },
  https: { term: "HTTPS", definition: "La conexión segura de un sitio: el candado del navegador. Sin HTTPS, los navegadores marcan el sitio como inseguro." },
  smtp: { term: "SMTP", definition: "La forma en que un programa manda mails a través de un servicio de correo (Brevo, Google, etc.)." },
  cuit: { term: "CUIT", definition: "El número de identificación fiscal de la empresa en Argentina: 11 dígitos, el último es un dígito verificador." },
  arca: { term: "ARCA", definition: "La agencia de recaudación (ex AFIP). Ahí se informan las facturas electrónicas." },
  organizacion: { term: "Organización", definition: "Un equipo (un medio, una ONG, una escuela) que comparte plan, reglas y salas." },
  sala: { term: "Sala del equipo", definition: "Un chat en vivo de la organización para seguir un tema juntos, con chequeos." },
  campana: { term: "Campaña", definition: "Una acción coordinada para responder un humo que circula (por ejemplo, una aclaración en varios canales). La revisa otra persona antes de lanzarse." },
  respuesta_publica: { term: "Respuesta pública", definition: "Una respuesta que se publica en un foro o una página, desde la cuenta de la organización. Pasa por revisión si hay riesgo." },
  aula: { term: "Aula", definition: "Un grupo del modo aprendizaje: la docente ve el progreso de cada estudiante por su apodo, sin datos de contacto." },
  datos_abiertos: { term: "Datos abiertos", definition: "Números agregados que cualquiera puede descargar y reusar. Nunca incluyen datos de personas: un grupo se publica sólo si lo forman muchas personas distintas." },
};

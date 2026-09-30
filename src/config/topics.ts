import type { Category, TopicDefinition } from "../domain/model";

/**
 * TAXONOMÍA INICIAL (semilla). Después se edita desde la API (`taxonomy:manage`):
 * esto sólo se carga si el tema o la categoría todavía no existen. Un tema que el equipo nunca
 * tocó (lo cargó "sistema") recibe las palabras clave nuevas de esta lista al arrancar.
 *
 * PALABRAS CLAVE: se buscan al principio de una palabra, sin tildes ni mayúsculas ("escuela"
 * encuentra "escuelas"). Gana el tema con más coincidencias; sin ninguna, la nota queda en "otros".
 * Por eso se evitan las cortas que son el comienzo de otras ("gol" → "golpe", "campo" → "Cámpora").
 */
export const SEED_CATEGORIES: Omit<Category, "active">[] = [
  { id: "economia", name: "Economía", order: 1 },
  { id: "servicios-publicos", name: "Servicios públicos", parentId: "economia", order: 1 },
  { id: "precios", name: "Precios y moneda", parentId: "economia", order: 2 },
  { id: "trabajo", name: "Trabajo", parentId: "economia", order: 3 },
  { id: "finanzas", name: "Finanzas e impuestos", parentId: "economia", order: 4 },
  { id: "produccion", name: "Producción y comercio", parentId: "economia", order: 5 },
  { id: "sociedad", name: "Sociedad", order: 2 },
  { id: "politica", name: "Política", order: 3 },
  { id: "mundo", name: "Mundo", order: 4 },
  { id: "deportes", name: "Deportes", order: 5 },
  { id: "cultura", name: "Cultura y espectáculos", order: 6 },
  { id: "ciencia", name: "Ciencia, tecnología y ambiente", order: 7 },
];

export interface SeedTopic {
  id: string;
  name: string;
  categoryId: string;
  keywords: string[];
  synonyms: string[];
  sensitive?: boolean;
}

export const SEED_TOPICS: SeedTopic[] = [
  { id: "tarifas-gas", name: "tarifas de gas", categoryId: "servicios-publicos", keywords: ["tarifa de gas", "tarifas de gas", "gas natural", "enargas", "garrafa"], synonyms: ["gas", "garrafa", "boleta de gas", "factura de gas"] },
  { id: "tarifas-luz", name: "tarifas de luz", categoryId: "servicios-publicos", keywords: ["tarifa de luz", "tarifas de luz", "energia electrica", "enre", "edenor", "edesur", "apagon", "corte de luz", "cortes de luz"], synonyms: ["luz", "electricidad", "boleta de luz"] },
  { id: "inflacion", name: "inflación", categoryId: "precios", keywords: ["inflacion", "indec", "ipc", "precios al consumidor", "canasta basica", "suba de precios", "aumentos", "cuanto suben", "prepagas"], synonyms: ["precios", "ipc", "suba de precios"] },
  { id: "dolar", name: "dólar", categoryId: "precios", keywords: ["dolar", "tipo de cambio", "cepo", "blue", "devaluacion", "cotizacion"], synonyms: ["dolar blue", "cotizacion", "tipo de cambio"] },
  { id: "empleo", name: "empleo", categoryId: "trabajo", keywords: ["desempleo", "desocupacion", "empleo", "salario", "paritaria", "paritarias", "sueldos", "despidos", "gremio", "sindicato", "cgt", "huelga", "paro general", "reforma laboral"], synonyms: ["trabajo", "sueldos", "salarios", "paritarias"] },
  { id: "jubilaciones", name: "jubilaciones y ayudas sociales", categoryId: "trabajo", keywords: ["jubilados", "jubilacion", "jubilaciones", "anses", "auh", "asignacion universal", "tarjeta alimentar", "pensiones", "haberes", "planes sociales", "bono previsional"], synonyms: ["jubilados", "anses", "auh", "planes sociales"] },
  { id: "mercados", name: "mercados y deuda", categoryId: "finanzas", keywords: ["bonos", "acciones", "wall street", "merval", "riesgo pais", "bcra", "banco central", "reservas", "tasa de interes", "tasas de interes", "plazo fijo", "inversores", "fmi", "fondo monetario", "deuda", "endeudamiento", "obligaciones negociables", "cedears"], synonyms: ["bonos", "riesgo pais", "fmi", "deuda externa"] },
  { id: "impuestos", name: "impuestos", categoryId: "finanzas", keywords: ["arca", "afip", "impuesto", "impuestos", "ganancias", "monotributo", "blanqueo", "retenciones", "tributario", "tributaria", "evasion"], synonyms: ["arca", "afip", "monotributo"] },
  { id: "produccion", name: "producción y comercio", categoryId: "produccion", keywords: ["importacion", "importaciones", "importar", "exportacion", "exportaciones", "exportar", "arancel", "aranceles", "industria", "industrial", "pymes", "pyme", "comercio exterior", "inversiones", "agro", "agropecuario", "cosecha", "soja", "trigo", "petroleo", "petrolera", "vaca muerta", "mineria", "litio", "rigi", "consumo", "automotriz", "frigorifico"], synonyms: ["industria", "exportaciones", "importaciones", "campo"] },
  { id: "vivienda", name: "vivienda y alquileres", categoryId: "sociedad", keywords: ["alquiler", "alquileres", "inquilinos", "inquilinas", "vivienda", "hipotecario", "hipotecarios", "inmobiliario", "inmobiliaria", "desarrolladoras"], synonyms: ["alquileres", "vivienda", "creditos hipotecarios"] },
  { id: "transporte", name: "transporte", categoryId: "sociedad", keywords: ["colectivo", "colectivos", "subte", "tren", "trenes", "boleto", "aerolineas", "vuelo", "vuelos", "aeropuerto", "avion", "peajes", "nafta", "combustible", "combustibles", "transito"], synonyms: ["colectivos", "trenes", "boleto", "nafta"] },
  { id: "seguridad", name: "seguridad", categoryId: "sociedad", keywords: ["robo", "homicidio", "delito", "policia", "inseguridad", "asesinato", "crimen", "narco", "narcotrafico", "abuso sexual", "femicidio", "secuestro", "tiroteo", "asalto", "detenido", "detenida", "detuvieron", "atropell"], synonyms: ["inseguridad", "delitos", "policiales"] },
  { id: "salud", name: "salud", categoryId: "sociedad", keywords: ["hospital", "vacuna", "salud publica", "dengue", "medicamentos", "medico", "medicos", "enfermedad", "cancer", "pami", "sanatorio", "epidemia"], synonyms: ["hospitales", "vacunas"], sensitive: true },
  { id: "educacion", name: "educación", categoryId: "sociedad", keywords: ["escuela", "docentes", "universidad", "clases", "educacion", "alumnos", "estudiantes"], synonyms: ["escuelas", "docentes", "universidades"] },
  { id: "religion", name: "religión", categoryId: "sociedad", keywords: ["papa francisco", "papa leon", "leon xiv", "iglesia", "obispo", "vaticano", "evangelista"], synonyms: ["iglesia", "papa"] },
  { id: "vida-cotidiana", name: "vida cotidiana", categoryId: "sociedad", keywords: ["receta", "recetas", "truco", "consejos", "limpieza", "horoscopo", "dieta", "mascotas", "entrenamiento", "bienestar"], synonyms: ["recetas", "consejos", "estilo de vida"] },
  { id: "elecciones", name: "elecciones", categoryId: "politica", keywords: ["elecciones", "candidato", "encuesta", "boleta", "comicios"], synonyms: ["votacion", "encuestas", "candidatos"], sensitive: true },
  { id: "gobierno", name: "gobierno nacional", categoryId: "politica", keywords: ["milei", "casa rosada", "gabinete", "decreto", "dnu", "boletin oficial", "ministro", "ministra", "gobierno nacional", "oficialismo", "oposicion", "kirchnerismo", "peronismo", "libertario", "la libertad avanza", "gobernador", "gobernadora", "intendente"], synonyms: ["gobierno", "politica nacional"], sensitive: true },
  { id: "congreso", name: "Congreso y leyes", categoryId: "politica", keywords: ["congreso", "diputados", "diputada", "senado", "senadores", "senadora", "proyecto de ley", "ley de", "sesion", "dictamen", "legislatura"], synonyms: ["leyes", "diputados", "senado"] },
  { id: "justicia", name: "justicia", categoryId: "politica", keywords: ["corte suprema", "juez", "jueza", "fiscalia", "el fiscal", "la fiscal", "fallo", "tribunal", "juicio", "camara federal", "comodoro py", "denuncia penal", "denunciado", "denunciada", "imputado", "imputada", "condena", "condenado", "procesado"], synonyms: ["tribunales", "corte suprema", "jueces"] },
  { id: "internacional", name: "internacional", categoryId: "mundo", keywords: ["estados unidos", "eeuu", "trump", "israel", "iran", "ucrania", "rusia", "china", "otan", "onu", "union europea", "brasil", "chile", "venezuela", "espana", "mexico", "colombia", "peru", "paraguay", "uruguay", "bolivia", "malvinas", "guerra", "gaza", "cancilleria", "canciller"], synonyms: ["mundo", "exterior", "relaciones exteriores"] },
  { id: "deportes", name: "deportes", categoryId: "deportes", keywords: ["futbol", "seleccion argentina", "scaloni", "messi", "boca", "river", "racing", "independiente", "san lorenzo", "goles", "torneo", "copa", "libertadores", "mundial", "liga", "formula 1", "gran premio", "tenis", "atp", "wta", "nba", "rugby", "los pumas", "boxeo", "entrenador", "hinchas", "estadio", "fifa", "amistoso", "clasico", "campeon", "jugadores", "futbolista"], synonyms: ["deporte"] },
  { id: "espectaculos", name: "espectáculos", categoryId: "cultura", keywords: ["actor", "actriz", "cantante", "recital", "concierto", "pelicula", "netflix", "streaming", "cine", "cineasta", "festival", "oscar", "album", "musica", "musico", "television", "masterchef", "gran hermano", "telenovela", "teatro", "escritor", "escritora", "novela", "modelo", "famoso", "famosa", "serie"], synonyms: ["farandula", "cultura"] },
  { id: "clima", name: "clima y ambiente", categoryId: "ciencia", keywords: ["clima", "pronostico", "tormenta", "tormentas", "lluvia", "lluvias", "alerta meteorologica", "smn", "temperatura", "calor", "ola de frio", "huracan", "inundacion", "inundaciones", "fenomeno el nino", "super nino", "sequia", "incendio forestal", "incendios forestales", "cambio climatico", "sismo", "terremoto", "alud"], synonyms: ["tiempo", "ambiente"] },
  { id: "tecnologia", name: "tecnología", categoryId: "ciencia", keywords: ["inteligencia artificial", "chatgpt", "celular", "celulares", "iphone", "samsung", "android", "apple", "google", "tecnologia", "ciberataque", "hackeo", "startup", "fintech", "cripto", "bitcoin", "aplicacion", "internet", "redes sociales", "elon musk"], synonyms: ["inteligencia artificial"] },
];

/** Vista simple (nombre + palabras clave) para el clasificador por palabras clave. */
export const TOPICS: TopicDefinition[] = SEED_TOPICS.map((t) => ({ name: t.name, keywords: t.keywords }));

/**
 * Datos de ejemplo. TODO ES FICTICIO: medios, dueños, provincia, partidos y cifras.
 * Dominios .example para que no apunten a sitios reales.
 */
import type { SeedData } from "../composition/container";
import type { Article, Region } from "../domain/model";

const d = (s: string) => new Date(`${s}T12:00:00-03:00`);
const VALLE: Region = { country: "AR", province: "Provincia del Valle" };
const CABA: Region = { country: "AR", province: "CABA" };
const TOPIC = "tarifas de gas";

const art = (id: string, outletId: string, url: string, date: string, title: string, body: string, region = VALLE): Article => ({
  id,
  outletId,
  url,
  title,
  body,
  publishedAt: d(date),
  region,
  topic: TOPIC,
});

export const demoSeed: SeedData = {
  outlets: [
    { id: "ana", name: "Agencia Nacional de Noticias", url: "https://ana-noticias.example", kind: "wire_agency", region: CABA },
    { id: "ddv", name: "El Diario del Valle", url: "https://diariodelvalle.example", kind: "newspaper", region: VALLE },
    { id: "lvc", name: "La Voz Capital", url: "https://lavozcapital.example", kind: "digital", region: CABA },
    { id: "ps", name: "Portal Sur", url: "https://portalsur.example", kind: "digital", region: VALLE },
    { id: "oy", name: "OpinionesYa", url: "https://opinionesya.example", kind: "digital", region: CABA },
  ],
  owners: [
    { id: "grupo-andino", name: "Grupo Andino", businessSectors: ["energía", "construcción"] },
    { id: "medios-federales", name: "Medios Federales S.A.", businessSectors: ["medios"] },
    { id: "coop-sur", name: "Cooperativa de Periodistas del Sur", businessSectors: ["medios"] },
  ],
  ownership: [
    { outletId: "ddv", ownerId: "grupo-andino", since: d("2019-01-01") },
    { outletId: "lvc", ownerId: "medios-federales", since: d("2015-01-01") },
    { outletId: "ps", ownerId: "coop-sur", since: d("2020-01-01") },
  ],
  searchableArticles: [
    art("ana-1", "ana", "https://ana-noticias.example/economia/aumento-gas", "2026-03-10",
      "Aprueban aumento en las tarifas de gas",
      "El ente regulador aprobó un aumento de 30% en las tarifas de gas a partir de abril, según la resolución 45 publicada en el Boletín Oficial. El aumento de las tarifas alcanza a 2 millones de usuarios residenciales de la provincia."),
    art("ddv-1", "ddv", "https://www.diariodelvalle.example/economia/tarifas-gas-aumento", "2026-03-10",
      "Golpe histórico: sube el gas",
      "El ente regulador aprobó un aumento de 30% en las tarifas de gas a partir de abril, según la resolución 45 publicada en el Boletín Oficial. El aumento de las tarifas alcanza a 2 millones de usuarios residenciales de la provincia. Es un golpe histórico para las familias. Según fuentes cercanas al gobierno, habría nuevos aumentos en 2 meses."),
    art("lvc-1", "lvc", "https://lavozcapital.example/politica/gas-ajuste-tarifas", "2026-03-11",
      "El Gobierno ordena las tarifas de gas",
      "El ente regulador aprobó un aumento de 18% en las tarifas de gas, según explicó el secretario de Energía Juan Pérez. La medida normaliza el sector y es un alivio para las cuentas públicas, lo que demuestra una mejora en la gestión. El aumento alcanza a 2 millones de usuarios.", CABA),
    art("ps-1", "ps", "https://portalsur.example/sociedad/gas-familias", "2026-03-12",
      "Las familias no llegan a pagar el gas",
      "El aumento de 30% en las tarifas de gas aprobado por el ente regulador es un fracaso para los usuarios. Las familias deberían recibir una tarifa social. Cabe destacar que 400 mil hogares no pueden pagar la factura, según datos del INDEC."),
    art("oy-1", "oy", "https://opinionesya.example/opinion/caos-gas", "2026-03-11",
      "CAOS TOTAL con el gas",
      "Es un caos total y una catástrofe sin precedentes: el gas sube 50% y dicen que va a haber un colapso del sistema.", CABA),
    art("ddv-2", "ddv", "https://diariodelvalle.example/politica/nuevo-esquema-gas", "2026-06-15",
      "Éxito del nuevo esquema tarifario",
      "El nuevo esquema de tarifas de gas es un éxito del gobierno provincial, lo que demuestra una mejora en el servicio. Se invertirán 500 millones en obras de gas, afirmó el gobernador Carlos Gómez."),
    art("ddv-3", "ddv", "https://diariodelvalle.example/economia/baja-gas", "2026-07-20",
      "Buenas noticias para los usuarios",
      "La tarifa de gas bajará 5% en septiembre, según fuentes cercanas al ente regulador. Es un alivio y un beneficio para las familias."),
  ],
  fetchableArticles: [
    art("re-1", "web:revista-energia.example", "https://revista-energia.example/analisis/tarifas-gas-2026", "2026-03-13",
      "Análisis técnico del aumento del gas",
      "Un análisis técnico estima que el aumento de las tarifas de gas es de 30% para los usuarios residenciales, según la resolución 45 del ente regulador. El costo de importación de gas subió 22% en el último año, según datos del INDEC."),
  ],
  advertising: [
    { outletId: "ddv", payer: "Gobierno de la Provincia del Valle", jurisdiction: "provincial", amount: 96_000_000, currency: "ARS", period: { from: d("2026-01-01"), to: d("2026-08-31") } },
    { outletId: "lvc", payer: "Gobierno Nacional", jurisdiction: "national", amount: 8_000_000, currency: "ARS", period: { from: d("2026-01-01"), to: d("2026-08-31") } },
  ],
  politicalContexts: [
    {
      region: { country: "AR" },
      governingForces: [{ name: "Coalición Nacional", jurisdiction: "national", from: d("2023-12-10") }],
      events: [],
    },
    {
      region: VALLE,
      governingForces: [
        { name: "Frente Provincial", jurisdiction: "provincial", from: d("2022-05-01"), to: d("2026-04-30") },
        { name: "Alianza Renovación", jurisdiction: "provincial", from: d("2026-05-01") },
      ],
      events: [{ date: d("2026-05-01"), kind: "government_change", description: "asume el gobierno provincial Alianza Renovación" }],
    },
  ],
  topicSectors: { gas: ["energía"], tarifa: ["energía", "servicios públicos"] },
};

export const DEMO_TOPIC = TOPIC;
export const demoDate = d;

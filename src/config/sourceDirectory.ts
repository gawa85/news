import type { DirectorySource } from "../domain/model";

/**
 * DIRECTORIO DE FUENTES PÚBLICAS CONOCIDAS: medios, agencias, verificadores y organismos que
 * publican un feed. Cada dirección se verificó (responde y trae notas) el 2026-09-30; en el
 * backoffice se puede volver a verificar. Los organismos oficiales casi no publican feeds: por eso
 * hay pocos. Si falta uno, se agrega a mano.
 */
export const SOURCE_DIRECTORY_VERIFIED_AT = "2026-09-30";

export const SOURCE_DIRECTORY: DirectorySource[] = [
  { id: "a24", name: "A24", site: "https://www.a24.com", feedUrl: "https://www.a24.com/rss/pages/home.xml", category: "nacional", kind: "tv", country: "AR", description: "Canal de noticias de TV." },
  { id: "ambito", name: "Ámbito", site: "https://www.ambito.com", feedUrl: "https://www.ambito.com/rss/pages/home.xml", category: "nacional", kind: "newspaper", country: "AR", description: "Diario de economía y finanzas." },
  { id: "c5n", name: "C5N", site: "https://www.c5n.com", feedUrl: "https://www.c5n.com/rss/pages/home.xml", category: "nacional", kind: "tv", country: "AR", description: "Canal de noticias de TV." },
  { id: "clarin", name: "Clarín", site: "https://www.clarin.com", feedUrl: "https://www.clarin.com/rss/lo-ultimo/", category: "nacional", kind: "newspaper", country: "AR", description: "Diario nacional (Buenos Aires)." },
  { id: "cronista", name: "El Cronista", site: "https://www.cronista.com", feedUrl: "https://www.cronista.com/files/rss/news.xml", category: "nacional", kind: "newspaper", country: "AR", description: "Diario de economía y negocios." },
  { id: "eldiarioar", name: "elDiarioAR", site: "https://www.eldiarioar.com", feedUrl: "https://www.eldiarioar.com/rss/", category: "nacional", kind: "digital", country: "AR", description: "Diario digital nacional." },
  { id: "infobae", name: "Infobae", site: "https://www.infobae.com", feedUrl: "https://www.infobae.com/arc/outboundfeeds/rss/", category: "nacional", kind: "digital", country: "AR", description: "Portal de noticias nacional." },
  { id: "iprofesional", name: "iProfesional", site: "https://www.iprofesional.com", feedUrl: "https://www.iprofesional.com/rss/home", category: "nacional", kind: "digital", country: "AR", description: "Portal de economía, negocios y tecnología." },
  { id: "lanacion", name: "La Nación", site: "https://www.lanacion.com.ar", feedUrl: "https://www.lanacion.com.ar/arc/outboundfeeds/rss/?outputType=xml", category: "nacional", kind: "newspaper", country: "AR", description: "Diario nacional (Buenos Aires)." },
  { id: "minutouno", name: "Minuto Uno", site: "https://www.minutouno.com", feedUrl: "https://www.minutouno.com/rss/pages/home.xml", category: "nacional", kind: "digital", country: "AR", description: "Portal de noticias nacional." },
  { id: "pagina12", name: "Página/12", site: "https://www.pagina12.com.ar", feedUrl: "https://www.pagina12.com.ar/arc/outboundfeeds/rss/?outputType=xml", category: "nacional", kind: "newspaper", country: "AR", description: "Diario nacional (Buenos Aires)." },
  { id: "perfil", name: "Perfil", site: "https://www.perfil.com", feedUrl: "https://www.perfil.com/feed", category: "nacional", kind: "newspaper", country: "AR", description: "Diario nacional (Buenos Aires)." },
  { id: "radiomitre", name: "Radio Mitre", site: "https://radiomitre.cienradios.com", feedUrl: "https://radiomitre.cienradios.com/arc/outboundfeeds/rss/?outputType=xml", category: "nacional", kind: "radio", country: "AR", description: "Radio AM nacional." },
  { id: "telefe", name: "Telefe Noticias", site: "https://noticias.mitelefe.com", feedUrl: "https://noticias.mitelefe.com/rss.xml", category: "nacional", kind: "tv", country: "AR", description: "Noticias del canal Telefe." },
  { id: "tiempoar", name: "Tiempo Argentino", site: "https://www.tiempoar.com.ar", feedUrl: "https://www.tiempoar.com.ar/feed/", category: "nacional", kind: "newspaper", country: "AR", description: "Diario nacional, cooperativa de trabajadores." },
  { id: "tn", name: "TN", site: "https://tn.com.ar", feedUrl: "https://tn.com.ar/arc/outboundfeeds/rss/?outputType=xml", category: "nacional", kind: "tv", country: "AR", description: "Canal de noticias de TV (Todo Noticias)." },
  { id: "europapress", name: "Europa Press (Latinoamérica)", site: "https://www.europapress.es/latam", feedUrl: "https://www.europapress.es/rss/rss.aspx?ch=00221", category: "agencia", kind: "wire_agency", country: "ES", description: "Agencia española, sección Latinoamérica." },
  { id: "noticiasargentinas", name: "Noticias Argentinas", site: "https://noticiasargentinas.com", feedUrl: "https://noticiasargentinas.com/rss", category: "agencia", kind: "wire_agency", country: "AR", description: "Agencia de noticias argentina." },
  { id: "chequeado", name: "Chequeado", site: "https://chequeado.com", feedUrl: "https://chequeado.com/feed/", category: "verificador", kind: "digital", country: "AR", description: "Verificación de datos y discursos públicos." },
  { id: "casarosada", name: "Casa Rosada", site: "https://www.casarosada.gob.ar", feedUrl: "https://www.casarosada.gob.ar/informacion/actividad-oficial?format=feed&type=rss", category: "oficial", kind: "official", country: "AR", description: "Comunicados de la Presidencia de la Nación." },
  { id: "bbcmundo", name: "BBC Mundo", site: "https://www.bbc.com/mundo", feedUrl: "https://feeds.bbci.co.uk/mundo/rss.xml", category: "internacional", kind: "digital", country: "GB", description: "Servicio en castellano de la BBC (Reino Unido)." },
  { id: "dw", name: "DW Español", site: "https://www.dw.com/es", feedUrl: "https://rss.dw.com/rdf/rss-sp-all", category: "internacional", kind: "digital", country: "DE", description: "Servicio en castellano de Deutsche Welle (Alemania)." },
  { id: "elpais", name: "El País (América)", site: "https://elpais.com/america", feedUrl: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/america/portada", category: "internacional", kind: "newspaper", country: "ES", description: "Edición América del diario español." },
  { id: "france24", name: "France 24 Español", site: "https://www.france24.com/es", feedUrl: "https://www.france24.com/es/rss", category: "internacional", kind: "digital", country: "FR", description: "Canal internacional francés, en castellano." },
  { id: "eldia", name: "El Día", site: "https://www.eldia.com", feedUrl: "https://www.eldia.com/rss/ultimas-noticias", category: "provincial", kind: "newspaper", country: "AR", province: "Buenos Aires", description: "Diario de Buenos Aires." },
  { id: "elancasti", name: "El Ancasti", site: "https://www.elancasti.com.ar", feedUrl: "https://www.elancasti.com.ar/rss/pages/home.xml", category: "provincial", kind: "newspaper", country: "AR", province: "Catamarca", description: "Diario de Catamarca." },
  { id: "eldiariodelchaco", name: "Diario Norte", site: "https://www.diarionorte.com", feedUrl: "https://www.diarionorte.com/rss", category: "provincial", kind: "newspaper", country: "AR", province: "Chaco", description: "Diario de Chaco." },
  { id: "corrientesal", name: "El Litoral de Corrientes", site: "https://www.ellitoral.com.ar", feedUrl: "https://www.ellitoral.com.ar/feed", category: "provincial", kind: "newspaper", country: "AR", province: "Corrientes", description: "Diario de Corrientes." },
  { id: "elcomercial", name: "El Comercial", site: "https://www.elcomercial.com.ar", feedUrl: "https://www.elcomercial.com.ar/rss", category: "provincial", kind: "newspaper", country: "AR", province: "Formosa", description: "Diario de Formosa." },
  { id: "diariouno", name: "Diario UNO", site: "https://www.diariouno.com.ar", feedUrl: "https://www.diariouno.com.ar/rss/pages/home.xml", category: "provincial", kind: "newspaper", country: "AR", province: "Mendoza", description: "Diario de Mendoza." },
  { id: "losandes", name: "Los Andes", site: "https://www.losandes.com.ar", feedUrl: "https://www.losandes.com.ar/rss/pages/home.xml", category: "provincial", kind: "newspaper", country: "AR", province: "Mendoza", description: "Diario de Mendoza." },
  { id: "misionesonline", name: "Misiones Online", site: "https://misionesonline.net", feedUrl: "https://misionesonline.net/feed/", category: "provincial", kind: "newspaper", country: "AR", province: "Misiones", description: "Diario de Misiones." },
  { id: "lmneuquen", name: "LM Neuquén", site: "https://www.lmneuquen.com", feedUrl: "https://www.lmneuquen.com/rss/pages/home.xml", category: "provincial", kind: "newspaper", country: "AR", province: "Neuquén", description: "Diario de Neuquén." },
  { id: "rionegro", name: "Diario Río Negro", site: "https://www.rionegro.com.ar", feedUrl: "https://www.rionegro.com.ar/feed/", category: "provincial", kind: "newspaper", country: "AR", province: "Río Negro", description: "Diario de Río Negro." },
  { id: "eltribuno", name: "El Tribuno", site: "https://www.eltribuno.com", feedUrl: "https://www.eltribuno.com/feed", category: "provincial", kind: "newspaper", country: "AR", province: "Salta", description: "Diario de Salta." },
  { id: "sanjuan8", name: "Diario de Cuyo", site: "https://www.diariodecuyo.com.ar", feedUrl: "https://www.diariodecuyo.com.ar/rss/pages/home.xml", category: "provincial", kind: "newspaper", country: "AR", province: "San Juan", description: "Diario de San Juan." },
  { id: "lacapital", name: "La Capital", site: "https://www.lacapital.com.ar", feedUrl: "https://www.lacapital.com.ar/rss/home.xml", category: "provincial", kind: "newspaper", country: "AR", province: "Santa Fe", description: "Diario de Santa Fe." },
  { id: "tiempofueguino", name: "Tiempo Fueguino", site: "https://www.tiempofueguino.com", feedUrl: "https://www.tiempofueguino.com/feed/", category: "provincial", kind: "newspaper", country: "AR", province: "Tierra del Fuego", description: "Diario de Tierra del Fuego." },
  { id: "lagaceta", name: "La Gaceta", site: "https://www.lagaceta.com.ar", feedUrl: "https://www.lagaceta.com.ar/rss/", category: "provincial", kind: "newspaper", country: "AR", province: "Tucumán", description: "Diario de Tucumán." },
];

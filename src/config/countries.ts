import type { CountryConfig } from "../domain/model";

/**
 * PAÍSES habilitados. Impuestos, leyes y precios son VALORES DE EJEMPLO:
 * revisarlos con un contador y un abogado de cada país antes de vender ahí.
 */
const r = (names: string[]) => names.map((name) => ({ code: name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]+/g, "_"), name }));

export const COUNTRIES: CountryConfig[] = [
  {
    code: "AR", name: "Argentina", currency: "ARS", locale: "es-AR", utcOffsetMinutes: -180,
    regions: r(["Ciudad Autónoma de Buenos Aires", "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán"]),
    tax: { name: "IVA", rate: 0.21, includedInPrice: true },
    taxId: { name: "CUIT", kind: "ar_cuit" },
    invoicing: "arca",
    dataProtection: "Ley 25.326 de Protección de Datos Personales",
    electoralAuthority: "Cámara Nacional Electoral",
  },
  {
    code: "UY", name: "Uruguay", currency: "UYU", locale: "es-UY", utcOffsetMinutes: -180,
    regions: r(["Artigas", "Canelones", "Cerro Largo", "Colonia", "Durazno", "Flores", "Florida", "Lavalleja", "Maldonado", "Montevideo", "Paysandú", "Río Negro", "Rivera", "Rocha", "Salto", "San José", "Soriano", "Tacuarembó", "Treinta y Tres"]),
    tax: { name: "IVA", rate: 0.22, includedInPrice: true },
    taxId: { name: "RUT", kind: "uy_rut" },
    invoicing: "receipt_only",
    dataProtection: "Ley 18.331 de Protección de Datos Personales",
    electoralAuthority: "Corte Electoral",
    planPrices: {
      personal: { month: { amount: 290, currency: "UYU", interval: "month" }, year: { amount: 2_900, currency: "UYU", interval: "year" } },
      profesional: { month: { amount: 790, currency: "UYU", interval: "month" }, year: { amount: 7_900, currency: "UYU", interval: "year" } },
    },
  },
  {
    code: "CL", name: "Chile", currency: "CLP", locale: "es-CL", utcOffsetMinutes: -180,
    regions: r(["Arica y Parinacota", "Tarapacá", "Antofagasta", "Atacama", "Coquimbo", "Valparaíso", "Metropolitana de Santiago", "O'Higgins", "Maule", "Ñuble", "Biobío", "La Araucanía", "Los Ríos", "Los Lagos", "Aysén", "Magallanes"]),
    tax: { name: "IVA", rate: 0.19, includedInPrice: true },
    taxId: { name: "RUT", kind: "cl_rut" },
    invoicing: "receipt_only",
    dataProtection: "Ley 19.628 sobre Protección de la Vida Privada (y su reforma, Ley 21.719)",
    electoralAuthority: "Servicio Electoral (Servel)",
    planPrices: {
      personal: { month: { amount: 5_990, currency: "CLP", interval: "month" }, year: { amount: 59_900, currency: "CLP", interval: "year" } },
      profesional: { month: { amount: 15_990, currency: "CLP", interval: "month" }, year: { amount: 159_900, currency: "CLP", interval: "year" } },
    },
  },
  {
    code: "MX", name: "México", currency: "MXN", locale: "es-MX", utcOffsetMinutes: -360,
    regions: r(["Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua", "Ciudad de México", "Coahuila", "Colima", "Durango", "Estado de México", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas"]),
    tax: { name: "IVA", rate: 0.16, includedInPrice: true },
    taxId: { name: "RFC", kind: "mx_rfc" },
    invoicing: "receipt_only",
    dataProtection: "Ley Federal de Protección de Datos Personales en Posesión de los Particulares",
    electoralAuthority: "Instituto Nacional Electoral (INE)",
    planPrices: {
      personal: { month: { amount: 99, currency: "MXN", interval: "month" }, year: { amount: 990, currency: "MXN", interval: "year" } },
      profesional: { month: { amount: 279, currency: "MXN", interval: "month" }, year: { amount: 2_790, currency: "MXN", interval: "year" } },
    },
  },
];

export const DEFAULT_COUNTRY = "AR";

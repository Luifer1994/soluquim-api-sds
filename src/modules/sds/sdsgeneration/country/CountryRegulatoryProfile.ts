/**
 * Lo que cambia de una FDS según el país de destino: la edición del SGA adoptada, de qué organismo se
 * toman primero los límites de exposición, la normativa que se cita y la de residuos para el P501.
 * Se lo dice al agente (bloque <country_rules>) y la sección 15 lista la normativa nacional.
 *
 * Para agregar un país: un perfil más en COUNTRY_REGULATORY_PROFILES, con normativa VERIFICADA (cada
 * norma debe salir de un documento oficial o de un procedimiento aprobado, nunca de memoria).
 */
export interface CountryRegulatoryProfile {
  /** ISO 3166-1 alfa-2. */
  code: string;
  name: string;
  /** Edición revisada del SGA adoptada legalmente. */
  ghsRevision: string;
  /** Organismos de límites de exposición, en el orden en que se prefieren. */
  exposureLimitAuthorities: string[];
  /** Normativa nacional de seguridad química que se cita en la sección 15. */
  regulations: string[];
  /** Normativa de residuos para el consejo P501 y la sección 13. */
  wasteRegulation?: string;
  /** Fuentes de consulta que exige o sugiere la normativa del país. */
  suggestedSources: string[];
  /**
   * Límites genéricos de mezcla: el SGA admite dos (Repr. 2: 0,1 % o 3 %; Carc. 2: 0,1 % o 1 %…). true = el
   * país (o el procedimiento aprobado) aplica el menor.
   */
  lowerGenericCutOffs: boolean;
  /** De dónde salió el perfil (trazabilidad). */
  basis: string;
}

export const COUNTRY_REGULATORY_PROFILES: readonly CountryRegulatoryProfile[] = [
  {
    code: 'CO',
    name: 'Colombia',
    ghsRevision: 'SGA, sexta edición revisada',
    exposureLimitAuthorities: ['ACGIH (TLV-TWA, TLV-STEL, TLV-C)', 'NIOSH (REL)', 'OSHA (PEL)'],
    regulations: [
      'Decreto 1496 de 2018: adopción del Sistema Globalmente Armonizado (SGA) de clasificación y etiquetado de productos químicos.',
      'Resolución 0773 de 2021: acciones para la implementación del SGA en los lugares de trabajo.',
    ],
    wasteRegulation: 'Decreto 1076 de 2015',
    suggestedSources: ['ACGIH', 'eChemPortal', 'GESTIS', 'IARC', 'GRE', 'Manual de Pruebas y Criterios de la ONU'],
    // La calculadora SGA de M&S aplica el límite menor (p. ej. Repr. 2 ≥ 0,1 % en la Fenolftaleína 1 %).
    lowerGenericCutOffs: true,
    basis: 'Procedimiento TR-P-01 Diseño de Fichas de Datos de Seguridad (M&S, v0, 10/04/2025)',
  },
];

export class CountryRegulatoryProfiles {
  static find(code?: string | null): CountryRegulatoryProfile | undefined {
    if (!code) return undefined;
    return COUNTRY_REGULATORY_PROFILES.find((profile) => profile.code === code.toUpperCase());
  }
}

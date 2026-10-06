export interface SdsFieldDefinition {
  /** Clave estable del campo (la devuelve el agente; no cambia aunque cambie la etiqueta). */
  key: string;
  label: string;
  /** Qué va exactamente en el campo (guía para el agente). */
  hint?: string;
  /** Cómo se estructura el valor además del texto (pictogramas, frases H/P, palabra de advertencia). */
  kind: SdsFieldKind;
}

export type SdsFieldKind = 'text' | 'pictograms' | 'statements' | 'signalWord';
export type SdsProductKind = 'substance' | 'mixture';

export interface SdsSubsectionDefinition {
  /** "4.1", "9.2"… */
  code: string;
  title: string;
  /** Apartado que solo existe para sustancias (3.1) o solo para mezclas (3.2). Sin valor = siempre. */
  appliesTo?: SdsProductKind;
  fields: SdsFieldDefinition[];
}

export interface SdsSectionDefinition {
  number: number;
  title: string;
  /**
   * Quién llena la sección:
   *  - `request`: solo con lo que mandó el usuario (datos del producto y la empresa). Nunca la IA.
   *  - `system`:  la arma el sistema (fecha, fuentes consultadas). Nunca la IA.
   *  - `agent`:   el agente, campo por campo, solo con datos de las fuentes y citándolos.
   *  - `sources`: volcado directo de datos estructurados de las fuentes, citados. Nunca la IA.
   */
  filledBy: 'request' | 'system' | 'agent' | 'sources';
  subsections: SdsSubsectionDefinition[];
}

const f = (key: string, label: string, hint?: string, kind: SdsFieldKind = 'text'): SdsFieldDefinition => ({
  key,
  label,
  hint,
  kind,
});

/**
 * PLANTILLA de la FDS: las 16 secciones con sus subsecciones y campos, según el formato del SGA /
 * Reglamento (CE) 1907/2006 (REACH, Anexo II). Es el contrato de lo que lleva cada sección:
 *  - el agente SOLO puede llenar estos campos (no agrega apartados ni texto libre),
 *  - un campo sin dato queda vacío ("Sin datos disponibles"), nunca se rellena,
 *  - es también la taxonomía con la que se etiqueta el conocimiento del RAG.
 */
export const SDS_SECTIONS: readonly SdsSectionDefinition[] = [
  {
    number: 1,
    title: 'Identificación de la sustancia o la mezcla y de la sociedad o la empresa',
    filledBy: 'request',
    subsections: [
      {
        code: '1.1',
        title: 'Identificadores del producto',
        fields: [f('productName', 'Nombre del producto'), f('casNumber', 'No. CAS')],
      },
    ],
  },
  {
    number: 2,
    title: 'Identificación de los peligros',
    filledBy: 'agent',
    subsections: [
      {
        code: '2.1',
        title: 'Clasificación de la sustancia o de la mezcla',
        fields: [
          f(
            'classification',
            'Clasificación',
            'Una línea por clase: clase y categoría de peligro con su código H (p. ej. "Líquidos inflamables, categoría 2 — H225"). Sustancia: la armonizada (CLP Anexo VI) si existe. Mezcla: un bloque por componente ("Acetona (60 %):" y debajo sus clases) y al final "Clasificación de la mezcla: pendiente del cálculo SGA".',
          ),
        ],
      },
      {
        code: '2.2',
        title: 'Elementos de la etiqueta',
        fields: [
          f(
            'pictograms',
            'Pictogramas',
            'Solo códigos GHS separados por coma (GHS02, GHS07…). Mezcla: todos los de sus componentes.',
            'pictograms',
          ),
          f(
            'signalWord',
            'Palabra de advertencia',
            '"Peligro" o "Atención". Mezcla: la más severa de sus componentes.',
            'signalWord',
          ),
          f(
            'hazardStatements',
            'Indicaciones de peligro (H)',
            'Solo códigos H separados por coma (H225, H319…). Mezcla: todos los de sus componentes.',
            'statements',
          ),
          f(
            'precautionaryStatements',
            'Consejos de prudencia (P)',
            'Solo códigos P separados por coma (P210, P305+P351+P338…). Mezcla: todos los de sus componentes.',
            'statements',
          ),
          f('supplementalHazard', 'Información suplementaria de peligro', 'Códigos EUH, si los hay.', 'statements'),
        ],
      },
      {
        code: '2.3',
        title: 'Otros peligros',
        fields: [
          f(
            'otherHazards',
            'Otros peligros',
            'PBT/mPmB, alteración endocrina u otros peligros no clasificados, solo si una fuente lo dice.',
          ),
        ],
      },
    ],
  },
  {
    number: 3,
    title: 'Composición / información sobre los componentes',
    filledBy: 'agent',
    subsections: [
      {
        code: '3.1',
        title: 'Sustancias',
        appliesTo: 'substance',
        fields: [
          f('synonyms', 'Sinónimos'),
          f('formula', 'Fórmula'),
          f('molecularWeight', 'Peso molecular', 'Con unidad (g/mol).'),
          f('casNumber', 'No. CAS'),
          f('ecNumber', 'No. CE'),
        ],
      },
      {
        code: '3.2',
        title: 'Mezclas',
        appliesTo: 'mixture',
        fields: [
          f(
            'components',
            'Componentes',
            'Una línea por componente: nombre, No. CAS, No. CE, clasificación (clases y códigos H), factores M si los hay, y concentración (la de <product>).',
          ),
        ],
      },
    ],
  },
  {
    number: 4,
    title: 'Primeros auxilios',
    filledBy: 'agent',
    subsections: [
      {
        code: '4.1',
        title: 'Descripción de los primeros auxilios',
        fields: [
          f('general', 'Recomendaciones generales'),
          f('inhalation', 'Si es inhalado'),
          f('skin', 'En caso de contacto con la piel'),
          f('eyes', 'En caso de contacto con los ojos'),
          f('ingestion', 'Por ingestión'),
        ],
      },
      {
        code: '4.2',
        title: 'Principales síntomas y efectos, agudos y retardados',
        fields: [f('symptoms', 'Síntomas y efectos')],
      },
      {
        code: '4.3',
        title:
          'Indicación de toda atención médica y de los tratamientos especiales que deban dispensarse inmediatamente',
        fields: [f('medicalAttention', 'Atención médica y tratamientos especiales')],
      },
    ],
  },
  {
    number: 5,
    title: 'Medidas de lucha contra incendios',
    filledBy: 'agent',
    subsections: [
      {
        code: '5.1',
        title: 'Medios de extinción',
        fields: [
          f('suitableMedia', 'Medios de extinción apropiados'),
          f('unsuitableMedia', 'Medios de extinción no apropiados'),
        ],
      },
      {
        code: '5.2',
        title: 'Peligros específicos derivados de la sustancia o la mezcla',
        fields: [
          f(
            'specificHazards',
            'Peligros específicos',
            'Comportamiento en el fuego: inflamabilidad, riesgo de explosión, mezclas vapor/aire.',
          ),
          f('hazardousCombustionProducts', 'Productos de combustión peligrosos'),
        ],
      },
      {
        code: '5.3',
        title: 'Recomendaciones para el personal de lucha contra incendios',
        fields: [f('firefighterAdvice', 'Equipo de protección y precauciones para bomberos')],
      },
    ],
  },
  {
    number: 6,
    title: 'Medidas en caso de vertido accidental',
    filledBy: 'agent',
    subsections: [
      {
        code: '6.1',
        title: 'Precauciones personales, equipo de protección y procedimientos de emergencia',
        fields: [f('personalPrecautions', 'Precauciones personales')],
      },
      {
        code: '6.2',
        title: 'Precauciones relativas al medio ambiente',
        fields: [f('environmentalPrecautions', 'Precauciones ambientales')],
      },
      {
        code: '6.3',
        title: 'Métodos y material de contención y de limpieza',
        fields: [f('cleanupMethods', 'Contención y limpieza')],
      },
    ],
  },
  {
    number: 7,
    title: 'Manipulación y almacenamiento',
    filledBy: 'agent',
    subsections: [
      {
        code: '7.1',
        title: 'Precauciones para una manipulación segura',
        fields: [f('safeHandling', 'Manipulación segura'), f('hygiene', 'Medidas de higiene')],
      },
      {
        code: '7.2',
        title: 'Condiciones de almacenamiento seguro, incluidas posibles incompatibilidades',
        fields: [
          f('storageConditions', 'Condiciones de almacenamiento'),
          f('incompatibilities', 'Incompatibilidades de almacenamiento'),
        ],
      },
      { code: '7.3', title: 'Usos específicos finales', fields: [f('specificEndUses', 'Usos específicos finales')] },
    ],
  },
  {
    number: 8,
    title: 'Controles de exposición / protección individual',
    filledBy: 'agent',
    subsections: [
      {
        code: '8.1',
        title: 'Parámetros de control',
        fields: [
          f(
            'exposureLimits',
            'Valores límite de exposición profesional',
            'Una línea por valor: componente, tipo de límite, valor con unidad y organismo/país (p. ej. "Etanol — VLA-EC: 1000 ppm, 1910 mg/m³ (INSST, España)"). Copiar tal cual.',
          ),
          f('biologicalLimits', 'Valores límite biológicos'),
        ],
      },
      {
        code: '8.2',
        title: 'Controles de la exposición',
        fields: [
          f('engineeringControls', 'Controles técnicos apropiados'),
          f('eyeProtection', 'Protección de los ojos / la cara'),
          f('skinHandProtection', 'Protección de la piel y las manos'),
          f('bodyProtection', 'Protección corporal'),
          f('respiratoryProtection', 'Protección respiratoria'),
          f('environmentalExposureControls', 'Control de exposición ambiental'),
        ],
      },
    ],
  },
  {
    number: 9,
    title: 'Propiedades físicas y químicas',
    filledBy: 'agent',
    subsections: [
      {
        code: '9.1',
        title: 'Información sobre propiedades físicas y químicas básicas',
        fields: [
          f('physicalState', 'Estado físico'),
          f('color', 'Color'),
          f('odor', 'Olor'),
          f('odorThreshold', 'Umbral olfativo'),
          f('meltingPoint', 'Punto de fusión / punto de congelación'),
          f('boilingPoint', 'Punto inicial de ebullición e intervalo de ebullición'),
          f('flammability', 'Inflamabilidad'),
          f('explosiveLimits', 'Límites de explosividad (inferior / superior)'),
          f('flashPoint', 'Punto de inflamación'),
          f('autoIgnitionTemperature', 'Temperatura de auto-inflamación'),
          f('decompositionTemperature', 'Temperatura de descomposición'),
          f('pH', 'pH'),
          f('viscosity', 'Viscosidad'),
          f('waterSolubility', 'Solubilidad en agua'),
          f('partitionCoefficient', 'Coeficiente de reparto n-octanol/agua (log Pow)'),
          f('vaporPressure', 'Presión de vapor'),
          f('density', 'Densidad / densidad relativa'),
          f('relativeVaporDensity', 'Densidad relativa del vapor'),
          f('particleCharacteristics', 'Características de las partículas'),
        ],
      },
      { code: '9.2', title: 'Otra información de seguridad', fields: [f('otherInformation', 'Otros datos')] },
    ],
  },
  {
    number: 10,
    title: 'Estabilidad y reactividad',
    filledBy: 'agent',
    subsections: [
      { code: '10.1', title: 'Reactividad', fields: [f('reactivity', 'Reactividad')] },
      { code: '10.2', title: 'Estabilidad química', fields: [f('chemicalStability', 'Estabilidad química')] },
      {
        code: '10.3',
        title: 'Posibilidad de reacciones peligrosas',
        fields: [f('hazardousReactions', 'Reacciones peligrosas')],
      },
      {
        code: '10.4',
        title: 'Condiciones que deben evitarse',
        fields: [f('conditionsToAvoid', 'Condiciones que deben evitarse')],
      },
      {
        code: '10.5',
        title: 'Materiales incompatibles',
        fields: [f('incompatibleMaterials', 'Materiales incompatibles')],
      },
      {
        code: '10.6',
        title: 'Productos de descomposición peligrosos',
        fields: [f('hazardousDecompositionProducts', 'Productos de descomposición peligrosos')],
      },
    ],
  },
  {
    number: 11,
    title: 'Información toxicológica',
    filledBy: 'agent',
    subsections: [
      {
        code: '11.1',
        title: 'Información sobre los efectos toxicológicos',
        fields: [
          f(
            'acuteToxicity',
            'Toxicidad aguda',
            'DL50 / CL50 por vía, especie, valor y unidad, por componente. Copiar tal cual.',
          ),
          f('skinCorrosionIrritation', 'Corrosión o irritación cutáneas'),
          f('eyeDamageIrritation', 'Lesiones o irritación ocular graves'),
          f('sensitization', 'Sensibilización respiratoria o cutánea'),
          f('germCellMutagenicity', 'Mutagenicidad en células germinales'),
          f('carcinogenicity', 'Carcinogenicidad', 'Incluir el grupo IARC si una fuente lo da.'),
          f('reproductiveToxicity', 'Toxicidad para la reproducción'),
          f('stotSingleExposure', 'Toxicidad específica en determinados órganos — exposición única'),
          f('stotRepeatedExposure', 'Toxicidad específica en determinados órganos — exposiciones repetidas'),
          f('aspirationHazard', 'Peligro de aspiración'),
        ],
      },
      {
        code: '11.2',
        title: 'Información adicional',
        fields: [f('additionalInformation', 'Información adicional', 'Vías de exposición y síntomas.')],
      },
    ],
  },
  {
    number: 12,
    title: 'Información ecológica',
    filledBy: 'agent',
    subsections: [
      {
        code: '12.1',
        title: 'Toxicidad',
        fields: [f('toxicity', 'Toxicidad', 'CL50 / CE50 para peces, dafnias y algas, con especie, valor y tiempo.')],
      },
      {
        code: '12.2',
        title: 'Persistencia y degradabilidad',
        fields: [f('persistence', 'Persistencia y degradabilidad')],
      },
      {
        code: '12.3',
        title: 'Potencial de bioacumulación',
        fields: [f('bioaccumulation', 'Potencial de bioacumulación')],
      },
      { code: '12.4', title: 'Movilidad en el suelo', fields: [f('soilMobility', 'Movilidad en el suelo')] },
      {
        code: '12.5',
        title: 'Resultados de la valoración PBT y mPmB',
        fields: [f('pbtAssessment', 'Valoración PBT y mPmB')],
      },
      {
        code: '12.6',
        title: 'Propiedades de alteración endocrina',
        fields: [f('endocrineDisruption', 'Alteración endocrina')],
      },
      { code: '12.7', title: 'Otros efectos adversos', fields: [f('otherAdverseEffects', 'Otros efectos adversos')] },
    ],
  },
  {
    number: 13,
    title: 'Consideraciones relativas a la eliminación',
    filledBy: 'agent',
    subsections: [
      {
        code: '13.1',
        title: 'Métodos para el tratamiento de residuos',
        fields: [
          f(
            'productDisposal',
            'Producto',
            'SOLO métodos de eliminación del residuo. No reutilizar aquí las medidas de derrame de la sección 6.',
          ),
          f('packagingDisposal', 'Envases contaminados'),
        ],
      },
    ],
  },
  {
    number: 14,
    title: 'Información relativa al transporte',
    filledBy: 'agent',
    subsections: [
      { code: '14.1', title: 'Número ONU', fields: [f('unNumber', 'Número ONU', '"UN" y cuatro dígitos (UN1170).')] },
      {
        code: '14.2',
        title: 'Designación oficial de transporte de las Naciones Unidas',
        fields: [
          f('properShippingName', 'Designación oficial de transporte', 'Solo la designación, sin el número ONU.'),
        ],
      },
      {
        code: '14.3',
        title: 'Clase(s) de peligro para el transporte',
        fields: [f('transportHazardClass', 'Clase de peligro')],
      },
      { code: '14.4', title: 'Grupo de embalaje', fields: [f('packingGroup', 'Grupo de embalaje')] },
      {
        code: '14.5',
        title: 'Peligros para el medio ambiente',
        fields: [f('environmentalHazards', 'Peligros para el medio ambiente / contaminante marino')],
      },
      {
        code: '14.6',
        title: 'Precauciones particulares para los usuarios',
        fields: [f('specialPrecautions', 'Precauciones particulares')],
      },
    ],
  },
  {
    number: 15,
    title: 'Información reglamentaria',
    filledBy: 'sources',
    subsections: [
      {
        code: '15.1',
        title:
          'Reglamentación y legislación en materia de seguridad, salud y medio ambiente específicas para la sustancia o la mezcla',
        fields: [
          f(
            'euHarmonisedClassification',
            'Clasificación y etiquetado armonizados (UE, CLP Anexo VI)',
            'Por componente: No. de índice, ATP, estado y fecha de la entrada armonizada, y sus notas si las hay.',
          ),
          f(
            'euRegulatoryProcesses',
            'Procesos y listas regulatorias de la UE (ECHA)',
            'Por componente: los procesos y listas en que figura (registro REACH, autorización, restricción, SVHC, valores límite indicativos…). Copia los identificadores tal cual; no los interpretes.',
          ),
          f(
            'occupationalExposureRegulation',
            'Reglamentación de exposición profesional',
            'Por componente: lista nacional o comunitaria de valores límite en que figura, año, y notas reglamentarias (p. ej. notas del INSST).',
          ),
          f(
            'carcinogenListings',
            'Listados de carcinógenos',
            'Por componente: grupo IARC, volumen y año de la monografía, si una fuente lo da.',
          ),
          f(
            'otherRegulations',
            'Otras disposiciones',
            'Cualquier otra reglamentación específica que citen las fuentes (prohibiciones de uso, inventarios).',
          ),
        ],
      },
      {
        code: '15.2',
        title: 'Evaluación de la seguridad química',
        fields: [f('chemicalSafetyAssessment', 'Evaluación de la seguridad química')],
      },
    ],
  },
  {
    number: 16,
    title: 'Otra información',
    filledBy: 'system',
    subsections: [
      {
        code: '16.1',
        title: 'Otra información',
        fields: [
          f('preparationDate', 'Fecha de elaboración'),
          f(
            'hStatementsFullText',
            'Texto íntegro de las indicaciones H referidas en las secciones 2 y 3',
            undefined,
            'statements',
          ),
          f('dataSources', 'Fuentes de datos consultadas'),
        ],
      },
    ],
  },
];

/** Prefijo de campo normalizado de las fuentes (`exposure.*`, `physical.*`…) → secciones que alimenta. */
const PREFIX_SECTIONS: Record<string, number[]> = {
  identity: [1, 3],
  ghs: [2, 15],
  hazard: [2],
  firstAid: [4],
  fire: [5],
  spill: [6],
  storage: [7],
  exposure: [8],
  protection: [8],
  physical: [9],
  thermo: [9],
  reactivity: [10],
  health: [11],
  toxicology: [11],
  carcinogenicity: [11, 15],
  ecology: [12],
  disposal: [13],
  transport: [14],
  regulatory: [15],
  notes: [16],
};

/** Campos que alimentan más secciones que su prefijo. */
const FIELD_SECTIONS: Record<string, number[]> = {
  'exposure.byRoute': [4, 8, 11],
  'exposure.idlh': [8, 11],
  'physical.flashPoint': [2, 9],
  'physical.lowerExplosiveLimit': [5, 9],
  'physical.upperExplosiveLimit': [5, 9],
  'reactivity.chemicalDangers': [7, 10],
  'reactivity.incompatibilities': [7, 10],
  'health.targetOrgans': [8, 11],
  'health.symptoms': [4, 11],
  'health.shortTermEffects': [4, 11],
  'health.longTermEffects': [4, 11],
  'fire.hazards': [5, 10],
  'spill.measures': [6, 13],
  'ecology.environment': [6, 12],
  'exposure.oel.es': [8, 15],
  'exposure.occupationalLimits': [8, 15],
  'identity.indexNumber': [1, 3, 15],
  'hazard.summary': [2, 11],
  'health.hazards': [2, 4, 11],
  'health.irritation': [4, 11],
  'health.acuteEffects': [4, 11],
  'firstAid.medicalTreatment': [4],
  'fire.combustionProducts': [5, 10],
  'spill.cleanup': [6, 13],
  'storage.handling': [7],
  'reactivity.decomposition': [9, 10],
  'reactivity.decompositionProducts': [5, 10],
  'reactivity.stability': [7, 10],
  'physical.explosiveLimits': [5, 9],
  'toxicology.summary': [2, 11],
  'transport.unNumber': [1, 14],
};

export class SdsSectionCatalog {
  static all(): readonly SdsSectionDefinition[] {
    return SDS_SECTIONS;
  }

  static get(number: number): SdsSectionDefinition {
    const section = SDS_SECTIONS.find((s) => s.number === number);
    if (!section) throw new Error(`Sección FDS inexistente: ${number}`);
    return section;
  }

  /** La plantilla de la sección para un tipo de producto: sin los apartados que no le aplican. */
  static forProduct(number: number, kind: SdsProductKind): SdsSectionDefinition {
    const section = SdsSectionCatalog.get(number);
    return { ...section, subsections: section.subsections.filter((sub) => !sub.appliesTo || sub.appliesTo === kind) };
  }

  /** Secciones que redacta el agente (las demás salen de la solicitud o del sistema). */
  static agentSections(): number[] {
    return SDS_SECTIONS.filter((s) => s.filledBy === 'agent').map((s) => s.number);
  }

  /** Texto para la búsqueda semántica: de qué trata la sección (títulos y campos). */
  static describe(number: number): string {
    const section = SdsSectionCatalog.get(number);
    return `${section.title}: ${section.subsections.map((sub) => `${sub.title} (${sub.fields.map((x) => x.label).join(', ')})`).join('; ')}`;
  }

  /** Secciones que alimenta un campo normalizado de una fuente. Lo desconocido va a "Otra información" (16). */
  static sectionsForField(field: string): number[] {
    return FIELD_SECTIONS[field] ?? PREFIX_SECTIONS[field.split('.')[0]] ?? [16];
  }
}

/**
 * Especialidades del agente redactor: cada grupo de secciones lo redacta el mismo agente, pero con el
 * criterio del especialista que firma esas secciones en una FDS real (qué dato va en cada campo, cuál
 * se prefiere cuando hay varios y cómo se presenta). Una especialidad = una llamada al modelo.
 * Para afinar una sección, editar su `guidance` y subir PROMPT_VERSION.
 */
export interface SdsSpecialistProfile {
  key: string;
  /** Secciones que redacta en una sola llamada (comparten fuentes). */
  sections: number[];
  role: string;
  guidance: string;
}

export const SDS_SPECIALIST_PROFILES: readonly SdsSpecialistProfile[] = [
  {
    key: 'classification',
    sections: [2, 3],
    role: 'Especialista en clasificación y etiquetado SGA/CLP',
    guidance: `- La clasificación armonizada (CLP Anexo VI, ECHA) manda sobre cualquier otra; si no existe, usa la notificada dominante de ECHA y, en su defecto, la de PubChem, indicando cuál es.
- "classification": una línea por clase, con el nombre de la clase EN EL IDIOMA PEDIDO, su categoría y su código H.
- Etiqueta: todos los pictogramas, la palabra de advertencia, y TODOS los códigos H, EUH y P que traigan las fuentes para esa clasificación. Los P salen de la fuente que los liste (PubChem); no los deduzcas.
- "otherHazards": solo peligros que una fuente afirme y que no estén en la clasificación (p. ej. formación de mezclas explosivas vapor/aire, peróxidos, PBT/mPmB).
- Composición: identificadores exactos (CAS, CE, No. de índice); en mezclas, una línea por componente con su clasificación y su concentración.`,
  },
  {
    key: 'emergency',
    sections: [4, 5, 6],
    role: 'Especialista en respuesta a emergencias químicas',
    guidance: `- Primeros auxilios: una instrucción por vía (inhalación, piel, ojos, ingestión), accionable y en imperativo. "general" solo si una fuente da medidas generales (p. ej. quitar la ropa contaminada, protección de quien auxilia).
- "symptoms": síntomas y efectos por vía de exposición, agudos y retardados. Casi siempre hay dato: búscalo en los fragmentos de síntomas, efectos sobre la salud y exposición por vía.
- "medicalAttention": tratamiento, antídotos o vigilancia médica que indiquen las fuentes para el personal sanitario (fragmentos de tratamiento de emergencia y antídotos), resumido en lo esencial y específico de ESTA sustancia.
- Incendio: en "suitableMedia" SOLO los agentes extintores; "unsuitableMedia" solo si una fuente lo dice; en "specificHazards" el comportamiento en el fuego y los productos de combustión o descomposición peligrosos; en "firefighterAdvice" el equipo y las precauciones de los bomberos.
- Vertido: reparte el texto de las fuentes en su campo — protección de las personas y evacuación en "personalPrecautions"; evitar desagües, suelo y aguas en "environmentalPrecautions"; contención, recogida, absorbentes y neutralización en "cleanupMethods". No copies el mismo texto en los tres.`,
  },
  {
    key: 'industrial-hygiene',
    sections: [7, 8],
    role: 'Higienista industrial',
    guidance: `- Manipulación: medidas técnicas y precauciones (ventilación, fuentes de ignición, electricidad estática); "hygiene" solo medidas de higiene personal.
- Almacenamiento: condiciones (temperatura, ventilación, recipientes) en "storageConditions" y sustancias o materiales de los que debe separarse en "incompatibilities".
- "exposureLimits": TODOS los valores límite que traigan las fuentes, uno por línea, con este orden: componente — tipo de límite (VLA-ED, VLA-EC, TLV-TWA, STEL, PEL, REL, IDLH…): valor con unidad (organismo/país). Primero los del país de destino o España (INSST) y la UE, luego ACGIH, NIOSH y OSHA. No conviertas ni promedies valores.
- "biologicalLimits": solo si una fuente da un valor límite biológico (VLB, BEI).
- Protección individual: el tipo concreto de equipo que indique la fuente (material de guantes, tipo de filtro, gafas); "engineeringControls" para ventilación y medidas técnicas.`,
  },
  {
    key: 'physical-chemistry',
    sections: [9, 10],
    role: 'Químico especialista en propiedades fisicoquímicas y reactividad',
    guidance: `- EXACTAMENTE un valor por propiedad (no listes alternativas ni el mismo dato en otra unidad): elige el dato EXPERIMENTAL mejor documentado sobre el predicho, en unidades SI (°C, kPa o hPa, g/cm³), con sus condiciones (temperatura, método, "copa cerrada"). Si solo hay °F o mmHg, da el valor original y la conversión entre paréntesis.
- Si las fuentes dan valores distintos, elige el experimental mejor documentado y registra la diferencia en "conflicts".
- En una disolución, indica la concentración a la que corresponde el dato si la fuente la da (p. ej. "38 °C (disolución al 25 %)").
- "flammability": si la fuente dice que es inflamable o no combustible. "otherInformation": umbral olfativo y otras propiedades de seguridad que no tengan campo propio.
- Sección 10: "reactivity" = reactividad general; "chemicalStability" = estabilidad en condiciones normales de uso y almacenamiento; "hazardousReactions" = reacciones violentas o peligrosas concretas; "conditionsToAvoid" = calor, luz, humedad, chispas…; "incompatibleMaterials" = lista de sustancias y materiales; "hazardousDecompositionProducts" = lo que se forma al descomponerse o arder. Cada dato en su campo, sin repetirlo.`,
  },
  {
    key: 'toxicology',
    sections: [11, 12],
    role: 'Toxicólogo y ecotoxicólogo regulatorio',
    guidance: `- "acuteToxicity": una línea por valor — tipo (DL50/CL50), vía, especie, valor con unidad y, si se da, duración. Solo las vías oral, cutánea e inhalación (no inyectables), a lo sumo dos valores por vía; prefiere rata y conejo.
- Cada clase de peligro para la salud tiene su campo: pon en él la evidencia que den las fuentes para ESE efecto (resultado de ensayo, clasificación o descripción). No llenes un efecto con datos de otro.
- "carcinogenicity": grupo IARC con su descripción y monografía, y otras clasificaciones (NTP, ACGIH, UE) que aparezcan.
- "additionalInformation": vías de exposición, órganos diana y síntomas.
- "toxicity" (12.1): una línea por valor, ordenado peces → invertebrados (dafnias) → algas → otros: parámetro (CL50/CE50/NOEC), especie, valor con unidad y tiempo de exposición. A lo sumo dos valores por grupo de organismos, los más bajos (más sensibles).
- "persistence": biodegradación (aerobia y anaerobia) y degradación abiótica. "bioaccumulation": factor de bioconcentración (BCF) y log Pow con su interpretación si la fuente la da. "soilMobility": Koc y movilidad. Resume cada uno en lo esencial, con sus cifras.
- "pbtAssessment" y "endocrineDisruption": solo si una fuente lo afirma expresamente.`,
  },
  {
    key: 'waste-transport',
    sections: [13, 14],
    role: 'Consejero de seguridad para residuos y transporte de mercancías peligrosas',
    guidance: `- "productDisposal": métodos de tratamiento y eliminación del residuo que indiquen las fuentes (incineración, neutralización, gestor autorizado), sin las medidas de derrame. "packagingDisposal": solo lo que digan sobre envases o recipientes.
- "unNumber": "UN" seguido de los cuatro dígitos (p. ej. UN1170). "properShippingName": SOLO la designación oficial de transporte, sin el número. "transportHazardClass": clase y, si lo hay, peligro subsidiario. "packingGroup": I, II o III.
- "environmentalHazards": contaminante marino o peligroso para el medio ambiente solo si una fuente lo dice o si tiene clasificación de peligro acuático.
- "specialPrecautions": guía de respuesta a emergencias, etiquetas o disposiciones que citen las fuentes.
- En una mezcla, los datos de transporte son los de cada componente clasificado: atribúyelos.`,
  },
];

export class SdsSpecialistProfiles {
  static all(): readonly SdsSpecialistProfile[] {
    return SDS_SPECIALIST_PROFILES;
  }

  /** La especialidad que cubre esas secciones (la que comparta más con ellas). */
  static forSections(sections: readonly number[]): SdsSpecialistProfile | undefined {
    return [...SDS_SPECIALIST_PROFILES]
      .map((profile) => ({ profile, shared: profile.sections.filter((n) => sections.includes(n)).length }))
      .filter(({ shared }) => shared > 0)
      .sort((a, b) => b.shared - a.shared)[0]?.profile;
  }
}

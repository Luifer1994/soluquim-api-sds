/**
 * Especialidades del agente redactor: cada grupo de secciones lo redacta el mismo agente, pero con el
 * criterio del especialista que firma esas secciones en una FDS real (qué dato va en cada campo, cuál
 * se prefiere cuando hay varios y cómo se presenta). Una especialidad = una llamada al modelo.
 * Para afinar una sección, editar su `guidance` y subir PROMPT_VERSION.
 *
 * `stage` sigue el orden de diseño del procedimiento TR-P-01 (Anexo 1): primero los datos y la
 * clasificación del producto (etapa 1: secciones 2, 3, 9, 10, 11, 12); después las medidas, que dependen de
 * ellos (etapa 2: emergencias, protección, eliminación y transporte), con la etapa 1 como contexto.
 */
export interface SdsSpecialistProfile {
  key: string;
  /** Secciones que redacta en una sola llamada (comparten fuentes). */
  sections: number[];
  /** 1 = datos y clasificación; 2 = medidas (usa lo redactado en la etapa 1). */
  stage: 1 | 2;
  role: string;
  guidance: string;
}

export const SDS_SPECIALIST_PROFILES: readonly SdsSpecialistProfile[] = [
  {
    key: 'classification',
    stage: 1,
    sections: [2, 3],
    role: 'Especialista en clasificación y etiquetado SGA/CLP',
    guidance: `- La clasificación armonizada (CLP Anexo VI, ECHA) manda sobre cualquier otra; si no existe, usa la notificada dominante de ECHA y, en su defecto, la de PubChem, indicando cuál es.
- "classification": una línea por clase, primero la clase de peligro y luego la categoría, EN EL IDIOMA PEDIDO, con su código H (p. ej. "Gases inflamables, categoría 1 — H220"). En toxicidad específica de órganos diana indica los órganos entre paréntesis ("Toxicidad específica de órganos diana – exposición única, categoría 3 (sistema respiratorio) — H335"). Usa la edición del SGA de <country_rules> si se da.
- Etiqueta: todos los pictogramas, la palabra de advertencia ("Peligro", "Atención" o "Sin palabra de advertencia" si la clasificación no la lleva), y TODOS los códigos H, EUH y P que traigan las fuentes para esa clasificación. Los P salen de la fuente que los liste (PubChem) o, si ninguna fuente los da, de la tabla del SGA en <reference> que asigna los P a cada indicación H (regla 15c, citando la R y la K de la clasificación). No los deduzcas de memoria.
- "otherHazards": solo peligros que una fuente afirme y que no estén en la clasificación y que contribuyan a la peligrosidad global: formación de mezclas explosivas vapor/aire, peróxidos, asfixia simple, congelación, contaminantes que se forman al curar o elaborar, PBT/mPmB. Para polvos combustibles la frase adecuada es "Puede formar una mezcla explosiva de polvo y aire si se dispersa".
- Composición: identificadores exactos (CAS, CE, No. de índice); en mezclas, una línea por componente peligroso con su clasificación y su concentración (exacta o en rango), en orden decreciente de concentración. En sustancias, las impurezas y aditivos estabilizadores solo si están clasificados y contribuyen a la clasificación.`,
  },
  {
    key: 'emergency',
    stage: 2,
    sections: [4, 5, 6],
    role: 'Especialista en respuesta a emergencias químicas',
    guidance: `- Primeros auxilios: una instrucción por vía (inhalación, piel, ojos, ingestión), accionable y en imperativo. "general" solo si una fuente o la documentación de referencia da medidas generales (p. ej. que el personal médico conozca el material, mantener a la víctima en reposo y con temperatura corporal normal, entregar la FDS al médico, que quien auxilia use EPP).
- "symptoms": síntomas y efectos por vía de exposición, agudos y retardados, y los efectos crónicos si los hay. Deben COMPLEMENTAR las indicaciones H (p. ej. un asfixiante simple no tiene frase H: aquí se dice). Casi siempre hay dato: búscalo en los fragmentos de síntomas, efectos sobre la salud y exposición por vía.
- "medicalAttention": tratamiento, antídotos o vigilancia médica que indiquen las fuentes para el personal sanitario (fragmentos de tratamiento de emergencia y antídotos), resumido en lo esencial y específico de ESTA sustancia.
- Incendio: en "suitableMedia" SOLO los agentes extintores; "unsuitableMedia" solo si una fuente lo dice; en "specificHazards" la inflamabilidad, el comportamiento en el fuego y los productos de combustión o descomposición peligrosos; en "firefighterAdvice" el equipo de protección y las precauciones de los bomberos, y medidas adicionales como rociar con agua los recipientes para mantenerlos fríos si una fuente las da.
- Si el producto tiene número ONU (en <knowledge>) y <reference> trae su guía de la GRE, úsala para incendio, derrame (distancias de aislamiento) y primeros auxilios, citando la R de la guía y la K del número ONU.
- Vertido: reparte el texto de las fuentes en su campo — protección de las personas (distinguiendo personal que no es de emergencias y personal de emergencias), EPP y evacuación en "personalPrecautions"; evitar desagües, suelo y aguas en "environmentalPrecautions"; contención, recogida, absorbentes y neutralización en "cleanupMethods". No copies el mismo texto en los tres.`,
  },
  {
    key: 'industrial-hygiene',
    stage: 2,
    sections: [7, 8],
    role: 'Higienista industrial',
    guidance: `- Manipulación: medidas técnicas y precauciones (ventilación, fuentes de ignición, electricidad estática); "hygiene" solo medidas de higiene personal.
- Almacenamiento: condiciones (temperatura, ventilación, recipientes) en "storageConditions" y sustancias o materiales de los que debe separarse en "incompatibilities".
- "exposureLimits": TODOS los valores límite que traigan las fuentes, uno por línea, con este orden: componente — tipo de límite (VLA-ED, VLA-EC, TLV-TWA, STEL, PEL, REL, IDLH…): valor con unidad (organismo/país). Si se dan <country_rules>, sigue su orden de organismos; si no, primero los del país de destino o España (INSST) y la UE, luego ACGIH, NIOSH y OSHA. No conviertas ni promedies valores.
- "biologicalLimits": solo si una fuente da un valor límite biológico (VLB, BEI).
- Protección individual: el tipo concreto de equipo que indique la fuente (material de guantes, tipo de filtro, gafas); "engineeringControls" para ventilación y medidas técnicas.`,
  },
  {
    key: 'physical-chemistry',
    stage: 1,
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
    stage: 1,
    sections: [11, 12],
    role: 'Toxicólogo y ecotoxicólogo regulatorio',
    guidance: `- "acuteToxicity": una línea por valor — tipo (DL50/CL50), vía, especie, valor con unidad y, si se da, duración. Solo las vías oral, cutánea e inhalación (no inyectables), a lo sumo dos valores por vía; prefiere rata y conejo.
- Cada clase de peligro para la salud tiene su campo: pon en él la evidencia que den las fuentes para ESE efecto (resultado de ensayo, clasificación o descripción), también si es negativa o no concluyente. Si fue evaluada y no cumple los criterios: "No cumple los criterios de clasificación". No llenes un efecto con datos de otro.
- "carcinogenicity": grupo IARC con su descripción y monografía, y otras clasificaciones (NTP, ACGIH, UE) que aparezcan.
- "additionalInformation": vías de exposición, órganos diana y síntomas.
- "toxicity" (12.1): una línea por valor, ordenado peces → invertebrados (dafnias) → algas → otros: parámetro (CL50/CE50/NOEC), especie, valor con unidad y tiempo de exposición. A lo sumo dos valores por grupo de organismos, los más bajos (más sensibles).
- "persistence": biodegradación (aerobia y anaerobia) y degradación abiótica. "bioaccumulation": factor de bioconcentración (BCF) y log Pow con su interpretación si la fuente la da. "soilMobility": Koc y movilidad. Resume cada uno en lo esencial, con sus cifras.
- "pbtAssessment" y "endocrineDisruption": solo si una fuente lo afirma expresamente.`,
  },
  {
    key: 'waste-transport',
    stage: 2,
    sections: [13, 14],
    role: 'Consejero de seguridad para residuos y transporte de mercancías peligrosas',
    guidance: `- "productDisposal": métodos de tratamiento y eliminación del residuo que indiquen las fuentes (incineración, neutralización, gestor autorizado), sin las medidas de derrame, y de conformidad con la normativa de residuos de <country_rules> si se da. "packagingDisposal": solo lo que digan sobre envases o recipientes.
- "unNumber": "UN" seguido de los cuatro dígitos (p. ej. UN1170). "properShippingName": SOLO la designación oficial de transporte, sin el número. "transportHazardClass": clase y, si lo hay, peligro subsidiario. "packingGroup": I, II o III.
- "environmentalHazards": contaminante marino o peligroso para el medio ambiente solo si una fuente lo dice o si tiene clasificación de peligro acuático.
- "specialPrecautions": guía de respuesta a emergencias (número de guía de la GRE), etiquetas o disposiciones especiales que citen las fuentes.
- Grupo de embalaje de un líquido inflamable (clase 3), según el punto de inflamación (PI) y el punto inicial de ebullición (PEb) del PRODUCTO: PEb ≤ 35 °C → I; PI < 23 °C y PEb > 35 °C → II; PI ≥ 23 °C y ≤ 60 °C → III. Si el producto es una mezcla y no hay PI de la mezcla, no lo tomes de un análogo con otra concentración: déjalo en null y regístralo en "conflicts".
- La designación oficial, la clase y el grupo de embalaje deben coincidir con la Lista de Mercancías Peligrosas de la Reglamentación Modelo de la ONU para ese número ONU: si <reference> la trae, valida contra ella y registra en "conflicts" cualquier diferencia.
- "bulkTransport": transporte a granel según el Anexo II de MARPOL 73/78 y el Código IBC, solo si una fuente o la referencia lo indica para este producto.
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

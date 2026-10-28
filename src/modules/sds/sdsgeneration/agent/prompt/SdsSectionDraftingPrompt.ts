import { SdsSectionDefinition } from '@/modules/knowledge';
import { SdsSpecialistProfile } from '@/modules/sds/sdsgeneration/agent/prompt/SdsSpecialistProfiles';
import { CountryRegulatoryProfile } from '@/modules/sds/sdsgeneration/country';

/**
 * Prompt del agente redactor de secciones. Al cambiar cualquier texto de este archivo, subir
 * PROMPT_VERSION: la versión queda guardada en cada FDS generada (trazabilidad).
 */
export const PROMPT_VERSION = 'sds-section-drafting.v11';

export const SYSTEM_PROMPT = `Eres un experto en toxicología y en reglamentación de productos químicos (SGA/GHS de la ONU, CLP de la UE, REACH, OSHA HazCom) que prepara Fichas de Datos de Seguridad (FDS).

Tu tarea: LLENAR LOS CAMPOS de las secciones pedidas (<template>) usando EXCLUSIVAMENTE lo que se te entrega: los datos de la sustancia o de sus componentes (<knowledge>, referencias K1, K2…), los documentos del producto que adjuntó el usuario (<product_documents>, referencias D1, D2…: FDS de los proveedores de las materias primas, FDS de productos análogos, datos del producto final) y la documentación de referencia (<reference>, referencias R1, R2…: libros del SGA, Guía de Respuesta en caso de Emergencia, Reglamentación Modelo de la ONU, Manual de Pruebas y Criterios, normativa y procedimientos internos de diseño de FDS). El resultado es un BORRADOR que revisará un profesional.

REGLAS (obligatorias):
1. PLANTILLA CERRADA. Devuelve exactamente los campos de <template>, con su "key". No agregues campos, apartados, introducciones, comentarios ni recomendaciones que no sean el contenido del campo.
2. NO INVENTES NI RELLENES. Tampoco escribas la palabra "null" dentro de un valor: omite ese dato. Un campo se llena SOLO si <knowledge> o <product_documents> traen ese dato, o si <reference> lo respalda para ESTE producto (ver regla 15). Si no lo trae: "value": null y "sourceRefs": []. No escribas "no disponible", "no se especifica" ni textos genéricos de relleno: usa null. Es mejor un campo vacío que un dato sin respaldo.
3. CADA VALOR SE CITA. Todo campo con valor lleva en "sourceRefs" las referencias (K…, D… y/o R…) de donde salió. Un valor sin referencia válida se descarta automáticamente. Las referencias van SOLO en "sourceRefs": nunca escribas "[K3]", "[D1]" ni "[R2]" dentro del valor.
4. SOLO LO QUE CORRESPONDE AL CAMPO. Pon en cada campo únicamente lo que ese campo pide (ver su indicación). No repitas en un campo lo de otro ni traigas información de otra sección (p. ej. las medidas de derrame no son métodos de eliminación).
5. VALORES NUMÉRICOS (límites de exposición, DL50, punto de inflamación…): cópialos tal cual con su unidad e indica de qué componente y de qué organismo o país son. Si conviertes unidades (°F→°C), conserva el valor original entre paréntesis.
6. CONTRADICCIONES: si las fuentes no coinciden, usa el valor MÁS CONSERVADOR (más protector) y regístralo en "conflicts" con el motivo.
7. CLASIFICACIÓN SGA (sección 2):
   - Sustancia pura: la clasificación armonizada (CLP Anexo VI, ECHA) si existe; si no, la notificada dominante u otra fuente, diciendo cuál. Llena TODOS los elementos de la etiqueta que traigan las fuentes (pictogramas, palabra de advertencia, H, P, EUH).
   - MEZCLA: NO calcules ni infieras la clasificación de la mezcla (la calcula otro componente del sistema con los porcentajes). En "classification" pon la de cada componente y termina con: "Clasificación de la mezcla: pendiente del cálculo SGA". Los elementos de la etiqueta de una MEZCLA SÍ se llenan: reúne los de TODOS sus componentes (todos los pictogramas, todos los códigos H, P y EUH, sin repetir) y la palabra de advertencia más severa ("Peligro" antes que "Atención"). Es la etiqueta más protectora posible hasta que se calcule la de la mezcla.
8. FRASES H, P y EUH y PICTOGRAMAS: en los campos de frases y de pictogramas pon SOLO los códigos separados por coma (H225, H319 · P210, P305+P351+P338 · GHS02, GHS07). El texto de cada frase lo agrega el sistema desde el catálogo oficial: no lo escribas.
9. MEZCLAS: atribuye cada dato a su componente ("Etanol: …") y no presentes una propiedad de un componente como propiedad de la mezcla. Los componentes SIN clasificación de peligro (agua y otros diluyentes inertes) solo se nombran en la composición (sección 3) y, en la clasificación, como "No clasificado como peligroso": NO llenes los demás campos con sus datos (ni sus propiedades, ni su toxicidad, ni su ecología). SUSTANCIA PURA: no antepongas el nombre de la sustancia a cada dato.
10. CONTEXTO: [principal] trata de estas secciones; [núcleo] es la identidad y clasificación del componente; [relacionado] es el resto de lo que se sabe de la sustancia. Puedes usar cualquiera, siempre citando. <reference> es documentación general (no habla de esta sustancia salvo que la nombre).
11. IDIOMA: TODOS los valores van en el idioma de <language>, venga la fuente en el idioma que venga. Traduce fielmente al idioma pedido (incluida la palabra de advertencia: Danger→Peligro, Warning→Atención, y el texto de frases H/P que traiga <knowledge>); traducir NO es inventar: no agregues ni quites contenido. Los parámetros y las especies también: LD50→DL50, LC50→CL50, EC50→CE50, rat→rata, rabbit→conejo, "one week"→"una semana". No se traducen: la designación oficial de transporte (se copia como la da la fuente), códigos (H225, P210, GHS02, UN1170), números y unidades, nombres propios, siglas de organismos (OSHA, NIOSH, VLA-ED, TLV) ni identificadores. Redacción concisa y técnica, sin adornos.
12. "confidence": high si los campos principales tienen dato de fuente oficial; medium si faltan varios o hay conflictos; low si casi todo queda vacío.
13. Devuelve SOLO el JSON pedido: UNA ÚNICA entrada en "sections" por cada sección de <template> (nunca repitas un número de sección), con TODOS sus campos (con valor o null).
14. SIN REPETICIONES: si varias fuentes dan el mismo dato, escríbelo una sola vez y cita todas. Un dato por línea cuando el campo lleve varios.
15. DOCUMENTACIÓN DE REFERENCIA (<reference>, R…). Consúltala SIEMPRE antes de responder y úsala para:
   a) APLICAR EL CRITERIO CORRECTO: formato y orden de cada campo, qué consejos P corresponden a cada indicación H, cómo se redacta cada sección según el procedimiento interno.
   b) VALIDAR los datos de <knowledge>: si una fuente contradice a la referencia oficial (p. ej. un número ONU o una clase de transporte), regístralo en "conflicts".
   c) COMPLETAR un campo que <knowledge> no trae cuando la referencia lo establece para ESTE producto a partir de un dato que SÍ está en <knowledge> (su número ONU, su clase o categoría de peligro, su estado físico). Ejemplos: las medidas de incendio, derrame y primeros auxilios de la guía GRE que corresponde a su número ONU; los consejos de prudencia que el SGA asigna a sus indicaciones H; la designación oficial y el grupo de embalaje de la Lista de Mercancías Peligrosas para su número ONU. Cita la R de la referencia Y la K del dato del producto en que te basas.
   d) NUNCA uses la referencia para atribuirle al producto propiedades o valores medidos (punto de inflamación, DL50, límites de exposición, pH…) que no estén en <knowledge>, ni para suponer un número ONU o una clasificación que <knowledge> no da.
16. REDACCIÓN (procedimiento de diseño de FDS): lenguaje claro, sencillo y preciso, dirigido a los trabajadores; sin jerga ni adornos. Evita siglas que no sean de uso normalizado en una FDS (sí: CAS, ONU, SGA, DL50, CL50, CE50, TLV, EPP, IARC).
17. FRASES PROHIBIDAS: nunca escribas (ni con otras palabras) "puede ser peligroso", "sin efectos sobre la salud", "seguro en casi todas las condiciones de uso", "seguro si se usa bien", "inocuo" o "no peligroso" como juicio general. Un valor que las contenga se descarta.
18. RESULTADOS NEGATIVOS O NO CONCLUYENTES: si una fuente reporta un ensayo negativo o no concluyente, se informa tal cual (con la fuente). Si la sustancia fue evaluada para una clase de peligro y no cumple los criterios, escribe "No cumple los criterios de clasificación" en ese campo, citando la fuente que lo dice.
19. NO APLICA: si un dato no aplica a este producto (p. ej. grupo de embalaje de un producto no regulado para el transporte, peligros térmicos de un sólido a temperatura ambiente), escribe "No aplica: <motivo>" citando el dato que lo justifica. No tener el dato NO es "no aplica": eso queda en null.
20. COHERENCIA: si se entrega <prior_sections> (secciones de esta misma ficha ya redactadas: clasificación, propiedades, toxicología), lo que redactes debe ser coherente con ellas: medios de extinción acordes al punto de inflamación y a la reactividad, protección personal acorde a la clasificación y a las vías de exposición, transporte acorde a la clasificación. <prior_sections> NO es fuente citable: cada valor sigue citando K, D o R.
21. PAÍS: si se entrega <country_rules>, sigue esas reglas (edición del SGA, orden de los límites de exposición, normativa de residuos para el P501 y la sección 13).
22. DOCUMENTOS DEL PRODUCTO (<product_documents>, D…): los adjuntó el usuario para ESTE producto; son datos citables.
   a) FDS del proveedor de un componente (materia prima): valen como datos de ESE componente (igual que K). En una mezcla, atribúyelos a ese componente por su nombre.
   b) FDS de un producto análogo (otra marca, composición o concentración parecida): SOLO sirve de modelo para redactar las medidas (primeros auxilios, incendio, derrame, manipulación, protección, eliminación) y su texto. NUNCA la uses para conclusiones de peligro (secciones 2, 11, 12), propiedades (9) ni datos de transporte que dependen de la concentración (grupo de embalaje): su composición (su sección 3) casi nunca es igual a la de este producto. Si un análogo y las fuentes no coinciden, regístralo en "conflicts".
   c) Datos del producto final (certificado de análisis, ficha técnica, requisitos del cliente): son los valores de la MEZCLA tal como se vende; tienen prioridad para la sección 9 (propiedades) y para los datos de identificación y uso.
   d) Si un documento del producto contradice a una fuente oficial (clasificación armonizada de ECHA, Lista de Mercancías Peligrosas), prima la oficial y regístralo en "conflicts".
23. MEZCLAS Y CONCENTRACIONES (si <product> es una MEZCLA): lo que aporta cada componente depende de su concentración. <mixture_rules> ya trae, por componente, cada clase de peligro, el límite que le aplica (el específico de ECHA si existe, si no el genérico del SGA) y si su % lo alcanza: úsalo, no deduzcas límites de memoria.
   - Un peligro que "ALCANZA el límite" pasa a la mezcla; uno "por debajo del límite" no, aunque el dato del componente puede mencionarse en "Componentes:". Los de "regla de adición" o "sumatoria" se suman entre componentes. Los de "depende del criterio de la autoridad" se informan como tales.
   - Propiedades físicas y químicas: los valores de un componente NO son los de la mezcla. Si un documento del producto o una fuente da el valor de la mezcla, úsalo ("17 °C (solución al 1 %)"). Si solo hay datos de componentes, informa el del componente mayoritario (≥ 50 %) indicándolo entre paréntesis: "-114 °C (Etanol)". Nunca los de componentes minoritarios.
   - Toxicología y ecotoxicología: en cada clase de peligro, primero la conclusión para el producto ("No se dispone de datos experimentales del producto final. Con base en sus componentes y sus concentraciones, …") y luego "Componentes:" con los datos de cada componente, por nombre.
   - Límites de exposición: uno por componente que lo tenga, con su nombre y CAS.
   - Transporte: una disolución lleva su designación oficial ("ETANOL EN SOLUCIÓN") y el grupo de embalaje depende del punto de inflamación de la MEZCLA, no del componente puro; sin ese dato, usa el de un documento del producto o registra la duda en "conflicts".
   - La clasificación final de la mezcla (2.1) no la calculas tú: describe lo que aporta cada componente; el cálculo SGA del sistema la confirma.`;

/** Prompt de sistema: las reglas comunes + el criterio del especialista de esas secciones. */
const REVIEW_BLOCK = `

SEGUNDA REVISIÓN — los campos de <template> quedaron VACÍOS en una primera pasada. Tu única tarea es comprobar, fragmento por fragmento, si alguno de <knowledge> o <product_documents> trae el dato de cada campo, o si <reference> lo establece para este producto (regla 15c):
- Si lo trae (aunque sea parcial, en otro idioma o dentro de un texto más largo), llena el campo y cítalo.
- Si de verdad ningún fragmento lo trae, déjalo en null. No lo llenes por compromiso: las reglas de no inventar siguen intactas.`;

export function buildSystemPrompt(specialist?: SdsSpecialistProfile, review = false): string {
  if (!specialist) return `${SYSTEM_PROMPT}${review ? REVIEW_BLOCK : ''}`;
  return `${SYSTEM_PROMPT}

ESPECIALIDAD — en esta tarea actúas como: ${specialist.role}.
Criterio profesional para estas secciones (aplícalo SIEMPRE dentro de las reglas anteriores: sigue sin poder inventarse nada):
${specialist.guidance}
- APROVECHA TODAS LAS FUENTES: antes de dejar un campo en null, revisa cada fragmento de <knowledge> (también los [relacionado]), de <product_documents> y de <reference>: si alguno trae ese dato (o la referencia lo establece para este producto), el campo se llena. Un campo queda vacío solo cuando NINGÚN fragmento lo trae.
- Los fragmentos de PubChem citan entre corchetes la colección de origen ([HSDB], [CAMEO Chemicals], [Haz-Map]…): es información publicada y se usa igual que el resto.${review ? REVIEW_BLOCK : ''}`;
}

export interface PromptComponent {
  cas: string;
  name: string | null;
  percentage: number;
  /** La concentración como la declaró el usuario ("≤ 99 %", "≥ 10 – < 20 %"). */
  concentration?: string;
  /** Sin clasificación de peligro (diluyente): solo va en la composición. */
  inert?: boolean;
}

/** Fragmento de un documento del producto (D1, D2…). */
export interface PromptProductDocument {
  ref: string;
  /** "FDS Etanol (Merck) · p. 3–4". */
  title: string;
  /** "FDS del proveedor", "FDS de producto análogo", "Datos del producto final". */
  kind: string;
  /** "Etanol (CAS 64-17-5)" si describe un componente. */
  component?: string;
  content: string;
}

/** Fragmento de documentación de referencia (R1, R2…). */
export interface PromptReference {
  ref: string;
  /** "GRE 2024 · p. 155–156". */
  title: string;
  category: string;
  content: string;
}

export interface PromptKnowledge {
  ref: string;
  source: string;
  cas: string | null;
  title: string;
  content: string;
  /** core = identidad/clasificación · section = de las secciones a redactar · related = contexto adicional. */
  relevance: 'core' | 'section' | 'related';
}

const RELEVANCE_LABEL = { core: 'núcleo', section: 'principal', related: 'relacionado' } as const;

/** La plantilla tal como la ve el agente: sección → subsección → campos (key, etiqueta, indicación). */
export function renderTemplate(sections: readonly SdsSectionDefinition[]): string {
  return sections
    .map((section) => {
      const subsections = section.subsections
        .map((sub) => {
          const fields = sub.fields
            .map((field) => `    - key "${field.key}": ${field.label}${field.hint ? ` — ${field.hint}` : ''}`)
            .join('\n');
          return `  ${sub.code} ${sub.title}\n${fields}`;
        })
        .join('\n');
      return `SECCIÓN ${section.number}. ${section.title}\n${subsections}`;
    })
    .join('\n\n');
}

/** Reglas del país de destino, tal como las lee el agente. */
export function renderCountryRules(country: CountryRegulatoryProfile): string {
  return [
    `País: ${country.name} (${country.code})`,
    `Edición del SGA: ${country.ghsRevision}`,
    `Límites de exposición, en este orden: ${country.exposureLimitAuthorities.join(' → ')}; luego los demás que traigan las fuentes.`,
    country.wasteRegulation
      ? `Residuos (P501 y sección 13): eliminar de conformidad con la normativa vigente (${country.wasteRegulation}).`
      : '',
    `Normativa nacional: ${country.regulations.join(' ')}`,
    `Fuentes que sugiere la normativa: ${country.suggestedSources.join(', ')}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildUserPrompt(params: {
  language: string;
  destinationCountry?: string;
  productName?: string;
  components: PromptComponent[];
  sections: readonly SdsSectionDefinition[];
  knowledge: PromptKnowledge[];
  references?: PromptReference[];
  productDocuments?: PromptProductDocument[];
  /** Qué aporta cada componente según su concentración (solo mezclas). */
  mixtureRules?: string;
  /** Secciones de esta ficha ya redactadas (etapa anterior), para la coherencia. */
  priorSections?: string;
  country?: CountryRegulatoryProfile;
}): string {
  const isMixture = params.components.length > 1;
  const components = params.components
    .map(
      (c) =>
        `- ${c.name ?? 'Sin nombre'} (CAS ${c.cas}): ${c.concentration ?? `${c.percentage} %`}${c.inert ? ' — sin clasificación de peligro (solo composición)' : ''}`,
    )
    .join('\n');
  const knowledge = params.knowledge.length
    ? params.knowledge.map((k) => `[${k.ref}] [${RELEVANCE_LABEL[k.relevance]}] ${k.title}\n${k.content}`).join('\n\n')
    : '(sin fragmentos de conocimiento para estas secciones)';
  const productDocuments = params.productDocuments?.length
    ? params.productDocuments
        .map((d) => `[${d.ref}] [${d.kind}${d.component ? ` · ${d.component}` : ''}] ${d.title}\n${d.content}`)
        .join('\n\n')
    : '';
  const references = params.references?.length
    ? params.references.map((r) => `[${r.ref}] [referencia: ${r.category}] ${r.title}\n${r.content}`).join('\n\n')
    : '';

  return `<product>
Tipo: ${isMixture ? `MEZCLA de ${params.components.length} componentes` : 'SUSTANCIA'}
Nombre: ${params.productName ?? '(no informado)'}
País de destino: ${params.destinationCountry ?? '(no informado)'}
Componentes:
${components}
</product>

<language>${params.language}</language>
${isMixture && params.mixtureRules ? `\n<mixture_rules>\n${params.mixtureRules}\n</mixture_rules>\n` : ''}${params.country ? `\n<country_rules>\n${renderCountryRules(params.country)}\n</country_rules>\n` : ''}${params.priorSections ? `\n<prior_sections>\n${params.priorSections}\n</prior_sections>\n` : ''}
<template>
${renderTemplate(params.sections)}
</template>

<knowledge>
${knowledge}
</knowledge>${productDocuments ? `\n\n<product_documents>\n${productDocuments}\n</product_documents>` : ''}${references ? `\n\n<reference>\n${references}\n</reference>` : ''}`;
}

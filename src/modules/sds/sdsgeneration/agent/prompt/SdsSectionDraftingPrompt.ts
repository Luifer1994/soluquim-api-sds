import { SdsSectionDefinition } from '@/modules/knowledge';
import { SdsSpecialistProfile } from '@/modules/sds/sdsgeneration/agent/prompt/SdsSpecialistProfiles';

/**
 * Prompt del agente redactor de secciones. Al cambiar cualquier texto de este archivo, subir
 * PROMPT_VERSION: la versión queda guardada en cada FDS generada (trazabilidad).
 */
export const PROMPT_VERSION = 'sds-section-drafting.v9';

export const SYSTEM_PROMPT = `Eres un experto en toxicología y en reglamentación de productos químicos (SGA/GHS de la ONU, CLP de la UE, REACH, OSHA HazCom) que prepara Fichas de Datos de Seguridad (FDS).

Tu tarea: LLENAR LOS CAMPOS de las secciones pedidas (<template>) usando EXCLUSIVAMENTE los fragmentos de conocimiento entregados (<knowledge>), cada uno con su referencia (K1, K2…). El resultado es un BORRADOR que revisará un profesional.

REGLAS (obligatorias):
1. PLANTILLA CERRADA. Devuelve exactamente los campos de <template>, con su "key". No agregues campos, apartados, introducciones, comentarios ni recomendaciones que no sean el contenido del campo.
2. NO INVENTES NI RELLENES. Tampoco escribas la palabra "null" dentro de un valor: omite ese dato. Un campo se llena SOLO si <knowledge> trae ese dato. Si no lo trae: "value": null y "sourceRefs": []. No escribas "no disponible", "no se especifica" ni textos genéricos de relleno: usa null. Es mejor un campo vacío que un dato sin respaldo.
3. CADA VALOR SE CITA. Todo campo con valor lleva en "sourceRefs" las referencias (K…) de donde salió. Un valor sin referencia válida se descarta automáticamente. Las referencias van SOLO en "sourceRefs": nunca escribas "[K3]" dentro del valor.
4. SOLO LO QUE CORRESPONDE AL CAMPO. Pon en cada campo únicamente lo que ese campo pide (ver su indicación). No repitas en un campo lo de otro ni traigas información de otra sección (p. ej. las medidas de derrame no son métodos de eliminación).
5. VALORES NUMÉRICOS (límites de exposición, DL50, punto de inflamación…): cópialos tal cual con su unidad e indica de qué componente y de qué organismo o país son. Si conviertes unidades (°F→°C), conserva el valor original entre paréntesis.
6. CONTRADICCIONES: si las fuentes no coinciden, usa el valor MÁS CONSERVADOR (más protector) y regístralo en "conflicts" con el motivo.
7. CLASIFICACIÓN SGA (sección 2):
   - Sustancia pura: la clasificación armonizada (CLP Anexo VI, ECHA) si existe; si no, la notificada dominante u otra fuente, diciendo cuál. Llena TODOS los elementos de la etiqueta que traigan las fuentes (pictogramas, palabra de advertencia, H, P, EUH).
   - MEZCLA: NO calcules ni infieras la clasificación de la mezcla (la calcula otro componente del sistema con los porcentajes). En "classification" pon la de cada componente y termina con: "Clasificación de la mezcla: pendiente del cálculo SGA". Los elementos de la etiqueta de una MEZCLA SÍ se llenan: reúne los de TODOS sus componentes (todos los pictogramas, todos los códigos H, P y EUH, sin repetir) y la palabra de advertencia más severa ("Peligro" antes que "Atención"). Es la etiqueta más protectora posible hasta que se calcule la de la mezcla.
8. FRASES H, P y EUH y PICTOGRAMAS: en los campos de frases y de pictogramas pon SOLO los códigos separados por coma (H225, H319 · P210, P305+P351+P338 · GHS02, GHS07). El texto de cada frase lo agrega el sistema desde el catálogo oficial: no lo escribas.
9. MEZCLAS: atribuye cada dato a su componente ("Etanol: …") y no presentes una propiedad de un componente como propiedad de la mezcla. Los componentes SIN clasificación de peligro (agua y otros diluyentes inertes) solo se nombran en la composición (sección 3) y, en la clasificación, como "No clasificado como peligroso": NO llenes los demás campos con sus datos (ni sus propiedades, ni su toxicidad, ni su ecología). SUSTANCIA PURA: no antepongas el nombre de la sustancia a cada dato.
10. CONTEXTO: [principal] trata de estas secciones; [núcleo] es la identidad y clasificación del componente; [relacionado] es el resto de lo que se sabe de la sustancia. Puedes usar cualquiera, siempre citando.
11. IDIOMA: TODOS los valores van en el idioma de <language>, venga la fuente en el idioma que venga. Traduce fielmente al idioma pedido (incluida la palabra de advertencia: Danger→Peligro, Warning→Atención, y el texto de frases H/P que traiga <knowledge>); traducir NO es inventar: no agregues ni quites contenido. Los parámetros y las especies también: LD50→DL50, LC50→CL50, EC50→CE50, rat→rata, rabbit→conejo, "one week"→"una semana". No se traducen: la designación oficial de transporte (se copia como la da la fuente), códigos (H225, P210, GHS02, UN1170), números y unidades, nombres propios, siglas de organismos (OSHA, NIOSH, VLA-ED, TLV) ni identificadores. Redacción concisa y técnica, sin adornos.
12. "confidence": high si los campos principales tienen dato de fuente oficial; medium si faltan varios o hay conflictos; low si casi todo queda vacío.
13. Devuelve SOLO el JSON pedido: UNA ÚNICA entrada en "sections" por cada sección de <template> (nunca repitas un número de sección), con TODOS sus campos (con valor o null).
14. SIN REPETICIONES: si varias fuentes dan el mismo dato, escríbelo una sola vez y cita todas. Un dato por línea cuando el campo lleve varios.`;

/** Prompt de sistema: las reglas comunes + el criterio del especialista de esas secciones. */
const REVIEW_BLOCK = `

SEGUNDA REVISIÓN — los campos de <template> quedaron VACÍOS en una primera pasada. Tu única tarea es comprobar, fragmento por fragmento, si alguno de <knowledge> trae el dato de cada campo:
- Si lo trae (aunque sea parcial, en otro idioma o dentro de un texto más largo), llena el campo y cítalo.
- Si de verdad ningún fragmento lo trae, déjalo en null. No lo llenes por compromiso: las reglas de no inventar siguen intactas.`;

export function buildSystemPrompt(specialist?: SdsSpecialistProfile, review = false): string {
  if (!specialist) return `${SYSTEM_PROMPT}${review ? REVIEW_BLOCK : ''}`;
  return `${SYSTEM_PROMPT}

ESPECIALIDAD — en esta tarea actúas como: ${specialist.role}.
Criterio profesional para estas secciones (aplícalo SIEMPRE dentro de las reglas anteriores: sigue sin poder inventarse nada):
${specialist.guidance}
- APROVECHA TODAS LAS FUENTES: antes de dejar un campo en null, revisa cada fragmento de <knowledge> (también los [relacionado]): si alguno trae ese dato, el campo se llena. Un campo queda vacío solo cuando NINGÚN fragmento lo trae.
- Los fragmentos de PubChem citan entre corchetes la colección de origen ([HSDB], [CAMEO Chemicals], [Haz-Map]…): es información publicada y se usa igual que el resto.${review ? REVIEW_BLOCK : ''}`;
}

export interface PromptComponent {
  cas: string;
  name: string | null;
  percentage: number;
  /** Sin clasificación de peligro (diluyente): solo va en la composición. */
  inert?: boolean;
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

export function buildUserPrompt(params: {
  language: string;
  destinationCountry?: string;
  productName?: string;
  components: PromptComponent[];
  sections: readonly SdsSectionDefinition[];
  knowledge: PromptKnowledge[];
}): string {
  const isMixture = params.components.length > 1;
  const components = params.components
    .map(
      (c) =>
        `- ${c.name ?? 'Sin nombre'} (CAS ${c.cas}): ${c.percentage} %${c.inert ? ' — sin clasificación de peligro (solo composición)' : ''}`,
    )
    .join('\n');
  const knowledge = params.knowledge.length
    ? params.knowledge.map((k) => `[${k.ref}] [${RELEVANCE_LABEL[k.relevance]}] ${k.title}\n${k.content}`).join('\n\n')
    : '(sin fragmentos de conocimiento para estas secciones)';

  return `<product>
Tipo: ${isMixture ? `MEZCLA de ${params.components.length} componentes` : 'SUSTANCIA'}
Nombre: ${params.productName ?? '(no informado)'}
País de destino: ${params.destinationCountry ?? '(no informado)'}
Componentes:
${components}
</product>

<language>${params.language}</language>

<template>
${renderTemplate(params.sections)}
</template>

<knowledge>
${knowledge}
</knowledge>`;
}

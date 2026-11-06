import { SdsSpecialistProfile } from '@/modules/sds/sdsgeneration/agent/prompt/SdsSpecialistProfiles';

/** Subir cada vez que cambian los prompts de la revisión de calidad (queda en cada FDS revisada). */
export const QUALITY_REVIEW_PROMPT_VERSION = 'sds-quality-review.v3';

/** Puntos de coherencia entre secciones que más fallan en una FDS (guía del líder de calidad). */
const CROSS_SECTION_CHECKS = [
  'Clasificación y frases H (2) frente a la toxicología (11) y la ecotoxicidad (12).',
  'Punto de inflamación y propiedades (9) frente a la clasificación de inflamabilidad (2) y el transporte (14).',
  'Medidas de protección y EPP (8) frente a los peligros (2) y las vías de exposición (11).',
  'Primeros auxilios (4) y lucha contra incendios (5) frente a los peligros y la reactividad (2, 10).',
  'Composición (3) frente a los componentes que se nombran en las demás secciones.',
  'Eliminación (13) y transporte (14) frente a la clasificación (2) y la ecotoxicidad (12).',
];

export function buildQualityLeadSystemPrompt(): string {
  return `Eres el líder de calidad de Fichas de Datos de Seguridad (FDS): revisas una ficha ya redactada por un equipo
de especialistas y buscas SOLO errores reales: contradicciones entre secciones, datos que no corresponden al producto o
valores implausibles. No reescribes la ficha ni opinas de estilo.

Cómo trabajas:
- Lee la ficha completa y anota las dudas concretas (campo, sección y por qué sospechas).
- Para cada duda, consulta al especialista de esa área con una pregunta precisa; si hace falta un dato, puedes
  buscarlo tú en las fuentes (search_sources, search_reference_docs, search_product_documents).
- Reporta un problema solo si un especialista lo confirmó como inconsistent o si la contradicción es evidente en la
  ficha misma. Si es uncertain, no lo reportes.
- La sugerencia va solo si el especialista dio un valor corregido con fuentes.

Revisa en especial:
${CROSS_SECTION_CHECKS.map((check) => `- ${check}`).join('\n')}

Si la ficha está bien, entrega una lista vacía.`;
}

export function buildQualityLeadUserPrompt(params: {
  language: string;
  productKind: 'substance' | 'mixture';
  components: string;
  country?: string;
  digest: string;
}): string {
  return [
    `<product kind="${params.productKind}" language="${params.language}"${params.country ? ` country="${params.country}"` : ''}>`,
    params.components,
    '</product>',
    '<sds_draft>',
    params.digest,
    '</sds_draft>',
  ].join('\n');
}

export function buildSpecialistReviewSystemPrompt(profile: SdsSpecialistProfile): string {
  return `Eres ${profile.role} y revisas una Ficha de Datos de Seguridad ya redactada. El líder de calidad te hace una
consulta concreta sobre tu área. Respóndela con datos: busca en las fuentes lo que necesites para confirmar o
corregir (search_sources: datos de cada sustancia; search_reference_docs: lo que establece la normativa;
search_product_documents: las FDS de las materias primas) y di de qué fuente sale. Haz pocas búsquedas y precisas
(dos o tres); si con ellas las fuentes no alcanzan, tu veredicto es uncertain. No inventes valores.

Tu criterio como especialista:
${profile.guidance}`;
}

export function buildSpecialistReviewUserPrompt(params: {
  question: string;
  casList: string[];
  digest: string;
}): string {
  return [
    `<question>${params.question}</question>`,
    `<components>${params.casList.join(', ')}</components>`,
    '<your_sections>',
    params.digest,
    '</your_sections>',
  ].join('\n');
}

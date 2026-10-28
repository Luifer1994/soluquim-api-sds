import { Inject, Injectable } from '@nestjs/common';
import { AgentSettings, BaseAgent, ChatMessage, LLM_PROVIDER, LlmProvider } from '@/shared/ai';
import { SdsSectionDefinition } from '@/modules/knowledge';
import {
  buildSystemPrompt,
  buildUserPrompt,
  PROMPT_VERSION,
  PromptComponent,
  PromptKnowledge,
  PromptProductDocument,
  PromptReference,
  SdsSpecialistProfile,
} from '@/modules/sds/sdsgeneration/agent/prompt';
import { CountryRegulatoryProfile } from '@/modules/sds/sdsgeneration/country';
import {
  SdsSectionDraftBatch,
  SdsSectionDraftBatchSchema,
} from '@/modules/sds/sdsgeneration/agent/SdsSectionDraftSchema';

export interface SdsSectionDraftingInput {
  language: string;
  destinationCountry?: string;
  /** Solo el nombre: los datos del proveedor NO se le pasan al agente (la sección 1 no la redacta la IA). */
  productName?: string;
  components: PromptComponent[];
  sections: readonly SdsSectionDefinition[];
  knowledge: PromptKnowledge[];
  /** Documentación de referencia (SGA, GRE, procedimientos…) relevante para estas secciones. */
  references?: PromptReference[];
  /** Documentos del producto adjuntos (FDS de las materias primas, de análogos…) para estas secciones. */
  productDocuments?: PromptProductDocument[];
  /** Qué aporta cada componente de la mezcla según su concentración. */
  mixtureRules?: string;
  /** Secciones de esta ficha ya redactadas en la etapa anterior (coherencia entre secciones). */
  priorSections?: string;
  /** Reglas del país de destino. */
  country?: CountryRegulatoryProfile;
  /** Especialidad con la que se redactan estas secciones (criterio experto adicional). */
  specialist?: SdsSpecialistProfile;
  /** Segunda pasada: <template> trae solo los campos que quedaron vacíos en la primera. */
  review?: boolean;
}

/**
 * Agente experto que LLENA LOS CAMPOS de un grupo de secciones de la FDS (plantilla cerrada de
 * SdsSectionCatalog) con los fragmentos del RAG por CAS, los documentos del producto adjuntos y la
 * documentación de referencia cargada. No agrega apartados, no clasifica mezclas y deja en null lo que las
 * fuentes no traen (ver reglas del prompt). Cada grupo lo redacta con el criterio de
 * su especialista (prompt/SdsSpecialistProfiles). Para cambiarle el modelo:
 * AI_AGENT_MODELS=sds-section-drafting=<modelo>. Para cambiar el prompt: editar prompt/ y subir la versión.
 */
@Injectable()
export class SdsSectionDraftingAgent extends BaseAgent<SdsSectionDraftingInput, SdsSectionDraftBatch> {
  readonly name = 'sds-section-drafting';
  readonly promptVersion = PROMPT_VERSION;
  protected readonly outputSchema = SdsSectionDraftBatchSchema;

  constructor(@Inject(LLM_PROVIDER) llm: LlmProvider, settings: AgentSettings) {
    super(llm, settings);
  }

  protected buildMessages(input: SdsSectionDraftingInput): ChatMessage[] {
    return [
      { role: 'system', content: buildSystemPrompt(input.specialist, input.review) },
      { role: 'user', content: buildUserPrompt(input) },
    ];
  }
}

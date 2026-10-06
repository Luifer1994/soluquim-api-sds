import { Inject, Injectable } from '@nestjs/common';
import { AgentSettings, BaseAgent, ChatMessage, LLM_PROVIDER, LlmProvider } from '@/shared/ai';
import { SdsSectionDefinition } from '@/modules/knowledge';
import {
  buildSystemPrompt,
  buildUserPrompt,
  PROMPT_VERSION,
  PromptComponent,
  PromptKnowledge,
  SdsSpecialistProfile,
} from '@/modules/sds/sdsgeneration/agent/prompt';
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
  /** Especialidad con la que se redactan estas secciones (criterio experto adicional). */
  specialist?: SdsSpecialistProfile;
  /** Segunda pasada: <template> trae solo los campos que quedaron vacíos en la primera. */
  review?: boolean;
}

/**
 * Agente experto que LLENA LOS CAMPOS de un grupo de secciones de la FDS (plantilla cerrada de
 * SdsSectionCatalog) con los fragmentos del RAG. No agrega apartados, no clasifica mezclas y deja en
 * null lo que las fuentes no traen (ver reglas del prompt). Cada grupo lo redacta con el criterio de
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

import { Inject, Injectable } from '@nestjs/common';
import { AgentSettings, AgentTool, ChatMessage, LLM_PROVIDER, LlmProvider, ToolCallingAgent } from '@/shared/ai';
import {
  buildSystemPrompt,
  buildUserPrompt,
  GAP_FILLING_PROMPT_VERSION,
  GAP_SEARCH_BLOCK,
} from '@/modules/sds/sdsgeneration/agent/prompt';
import {
  SdsSectionDraftBatch,
  SdsSectionDraftBatchSchema,
} from '@/modules/sds/sdsgeneration/agent/SdsSectionDraftSchema';
import {
  SdsSectionDraftingAgent,
  SdsSectionDraftingInput,
} from '@/modules/sds/sdsgeneration/agent/SdsSectionDraftingAgent';

export interface SdsGapFillingInput {
  /** La entrada de la 2.ª pasada: solo los campos vacíos (`sections`), con `review: true`. */
  drafting: SdsSectionDraftingInput;
  /**
   * Búsquedas de ESTA ejecución (SdsSourceSearchToolkit con el registro de citas del grupo): lo que encuentran queda
   * como referencia S…, R… o D… y su cita se valida igual que la del contexto inicial.
   */
  tools: readonly AgentTool[];
}

/**
 * 2.ª pasada con búsqueda dirigida (AI_SDS_AGENTIC_GAP_FILL): el especialista, en vez de releer los mismos
 * fragmentos, BUSCA el dato puntual de cada campo vacío en las fuentes (base de conocimiento por CAS, documentación
 * de referencia y documentos del producto). Devuelve lo mismo que el redactor (`SdsSectionDraftBatch`), así el armado
 * y la validación de citas no cambian. Modelo propio: AI_AGENT_MODELS=sds-gap-filling=<modelo> (sin él, el del
 * redactor).
 */
@Injectable()
export class SdsGapFillingAgent extends ToolCallingAgent<SdsGapFillingInput, SdsSectionDraftBatch> {
  readonly name = 'sds-gap-filling';
  readonly promptVersion = GAP_FILLING_PROMPT_VERSION;
  protected readonly outputSchema = SdsSectionDraftBatchSchema;
  protected override readonly finalAnswerDescription =
    'Entrega el JSON de las secciones con los campos que pudiste llenar (los demás en null), con sus sourceRefs.';

  constructor(@Inject(LLM_PROVIDER) llm: LlmProvider, settings: AgentSettings) {
    super(llm, settings);
  }

  override get model(): string {
    return this.settings.modelOverride(this.name) ?? this.settings.modelFor(SdsSectionDraftingAgent.AGENT_NAME);
  }

  protected buildMessages({ drafting }: SdsGapFillingInput): ChatMessage[] {
    return [
      { role: 'system', content: `${buildSystemPrompt(drafting.specialist, true)}${GAP_SEARCH_BLOCK}` },
      { role: 'user', content: buildUserPrompt(drafting) },
    ];
  }

  protected tools({ tools }: SdsGapFillingInput): readonly AgentTool[] {
    return tools;
  }
}

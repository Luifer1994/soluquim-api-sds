import { Inject, Injectable } from '@nestjs/common';
import { AgentSettings, AgentTool, ChatMessage, LLM_PROVIDER, LlmProvider, ToolCallingAgent } from '@/shared/ai';
import {
  buildSpecialistReviewSystemPrompt,
  buildSpecialistReviewUserPrompt,
  QUALITY_REVIEW_PROMPT_VERSION,
  SdsSpecialistProfile,
} from '@/modules/sds/sdsgeneration/agent/prompt';
import {
  SdsSpecialistOpinion,
  SdsSpecialistOpinionSchema,
} from '@/modules/sds/sdsgeneration/agent/review/SdsQualityReviewSchema';

export interface SdsSpecialistReviewInput {
  profile: SdsSpecialistProfile;
  /** Consulta concreta del líder de calidad. */
  question: string;
  casList: string[];
  /** Las secciones de su especialidad (y las que la consulta involucra), ya redactadas. */
  digest: string;
  /** Búsquedas en las fuentes de esta FDS (SdsSourceSearchToolkit) para verificar. */
  tools: readonly AgentTool[];
}

/**
 * Subagente de la revisión de calidad: un especialista (el mismo perfil que redactó esas secciones) que responde
 * una consulta puntual verificando contra las fuentes de la FDS (base de conocimiento, normativa y documentos del
 * producto). Corre con su propio contexto corto; al líder solo le vuelve su opinión. Modelo propio:
 * AI_AGENT_MODELS=sds-specialist-review=<modelo>.
 */
@Injectable()
export class SdsSpecialistReviewAgent extends ToolCallingAgent<SdsSpecialistReviewInput, SdsSpecialistOpinion> {
  readonly name = 'sds-specialist-review';
  readonly promptVersion = QUALITY_REVIEW_PROMPT_VERSION;
  protected readonly outputSchema = SdsSpecialistOpinionSchema;

  constructor(@Inject(LLM_PROVIDER) llm: LlmProvider, settings: AgentSettings) {
    super(llm, settings);
  }

  protected buildMessages(input: SdsSpecialistReviewInput): ChatMessage[] {
    return [
      { role: 'system', content: buildSpecialistReviewSystemPrompt(input.profile) },
      { role: 'user', content: buildSpecialistReviewUserPrompt(input) },
    ];
  }

  protected tools({ tools }: SdsSpecialistReviewInput): readonly AgentTool[] {
    return tools;
  }
}

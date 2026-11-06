import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  AgentSettings,
  AgentTool,
  ChatMessage,
  LLM_PROVIDER,
  LlmProvider,
  OrchestratorAgent,
  SubAgentTool,
} from '@/shared/ai';
import {
  buildQualityLeadSystemPrompt,
  buildQualityLeadUserPrompt,
  QUALITY_REVIEW_PROMPT_VERSION,
  SdsSpecialistProfile,
  SdsSpecialistProfiles,
} from '@/modules/sds/sdsgeneration/agent/prompt';
import { SdsDraftDigest, SdsDraftSuggestions } from '@/modules/sds/sdsgeneration/agent/review/SdsDraftDigest';
import {
  SdsQualityReview,
  SdsQualityReviewSchema,
} from '@/modules/sds/sdsgeneration/agent/review/SdsQualityReviewSchema';
import { SdsSpecialistReviewAgent } from '@/modules/sds/sdsgeneration/agent/review/SdsSpecialistReviewAgent';

/** Secciones que redacta la IA (1, 15 y 16 salen de la solicitud, las fuentes y el sistema). */
export const REVIEWED_SECTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export interface SdsQualityReviewInput {
  language: string;
  productKind: 'substance' | 'mixture';
  components: Array<{ cas: string; name: string | null; concentration: string }>;
  country?: string;
  suggestions: SdsDraftSuggestions;
  /** Búsquedas en las fuentes de esta FDS (SdsSourceSearchToolkit): las usan el líder y sus especialistas. */
  tools: readonly AgentTool[];
}

const ConsultArgs = z.object({
  question: z.string().min(10).describe('Consulta concreta: qué campo, de qué sección y qué sospechas'),
  sections: z
    .array(z.number().int().min(2).max(14))
    .optional()
    .describe('Otras secciones que el especialista debe ver para responder (además de las suyas)'),
});

/**
 * Líder de calidad de la FDS (orquestador): lee la ficha redactada completa, busca contradicciones entre secciones y
 * DELEGA cada duda en el especialista de esa área ({@link SdsSpecialistReviewAgent}, uno por perfil, como
 * subagente), que la verifica contra la base de conocimiento. Devuelve solo los problemas confirmados; no cambia la
 * ficha (los problemas quedan como conflictos de la sección para el revisor). Modelo propio:
 * AI_AGENT_MODELS=sds-quality-review=<modelo>.
 */
@Injectable()
export class SdsQualityReviewAgent extends OrchestratorAgent<SdsQualityReviewInput, SdsQualityReview> {
  readonly name = 'sds-quality-review';
  readonly promptVersion = QUALITY_REVIEW_PROMPT_VERSION;
  protected readonly outputSchema = SdsQualityReviewSchema;

  constructor(
    @Inject(LLM_PROVIDER) llm: LlmProvider,
    settings: AgentSettings,
    private readonly specialist: SdsSpecialistReviewAgent,
  ) {
    super(llm, settings);
  }

  protected subAgents(input: SdsQualityReviewInput): readonly AgentTool[] {
    return SdsSpecialistProfiles.all().map((profile) => this.consult(profile, input));
  }

  protected override ownTools({ tools }: SdsQualityReviewInput): readonly AgentTool[] {
    return tools;
  }

  protected buildMessages(input: SdsQualityReviewInput): ChatMessage[] {
    return [
      { role: 'system', content: `${buildQualityLeadSystemPrompt()}\n\n${this.delegationGuide(input)}` },
      {
        role: 'user',
        content: buildQualityLeadUserPrompt({
          language: input.language,
          productKind: input.productKind,
          country: input.country,
          components: input.components
            .map((c) => `- ${c.name ?? 'Sin nombre'} (CAS ${c.cas}): ${c.concentration}`)
            .join('\n'),
          digest: SdsDraftDigest.render(input.suggestions, REVIEWED_SECTIONS),
        }),
      },
    ];
  }

  /** Un especialista como subagente: recibe la consulta y SUS secciones (más las que pida el líder). */
  private consult(profile: SdsSpecialistProfile, input: SdsQualityReviewInput): AgentTool {
    return new SubAgentTool({
      name: `consult_${profile.key.replace(/-/g, '_')}`,
      description: `${profile.role} (secciones ${profile.sections.join(', ')}). Consúltale una duda concreta de su área; verifica con las fuentes y responde si está bien, si hay que corregir (con el valor) o si no hay datos.`,
      inputSchema: ConsultArgs,
      agent: this.specialist,
      toInput: ({ question, sections = [] }) => ({
        profile,
        question,
        casList: input.components.map((c) => c.cas),
        digest: SdsDraftDigest.render(input.suggestions, [...profile.sections, ...sections]),
        tools: input.tools,
      }),
    });
  }
}

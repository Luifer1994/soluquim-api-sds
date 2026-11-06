import { AgentSettings, ChatMessage, LlmProvider } from '@/shared/ai';
import { SdsSpecialistProfile } from '@/modules/sds/sdsgeneration/agent/prompt';
import {
  SdsSectionDraftingAgent,
  SdsSectionDraftingInput,
} from '@/modules/sds/sdsgeneration/agent/SdsSectionDraftingAgent';

/**
 * Un especialista como agente propio (subagente de la redacción): el mismo prompt y las mismas reglas que
 * {@link SdsSectionDraftingAgent}, con SU perfil fijo. Así cada especialidad se configura, se mide y evoluciona por
 * separado: modelo propio con `AI_AGENT_MODELS=sds-drafting-<clave>=<modelo>` (sin él, el del redactor general),
 * uso y traza con su nombre. Los crea {@link SdsSpecialistDraftingAgents}.
 */
export class SdsSpecialistDraftingAgent extends SdsSectionDraftingAgent {
  override readonly name: string;

  constructor(
    llm: LlmProvider,
    settings: AgentSettings,
    readonly profile: SdsSpecialistProfile,
  ) {
    super(llm, settings);
    this.name = SdsSpecialistDraftingAgent.nameFor(profile);
  }

  static nameFor(profile: SdsSpecialistProfile): string {
    return `sds-drafting-${profile.key}`;
  }

  override get model(): string {
    return this.settings.modelOverride(this.name) ?? this.settings.modelFor(SdsSectionDraftingAgent.AGENT_NAME);
  }

  protected override buildMessages(input: SdsSectionDraftingInput): ChatMessage[] {
    return super.buildMessages({ ...input, specialist: this.profile });
  }
}

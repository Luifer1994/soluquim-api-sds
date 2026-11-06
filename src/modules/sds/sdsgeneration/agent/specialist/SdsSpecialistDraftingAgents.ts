import { Inject, Injectable } from '@nestjs/common';
import { AgentSettings, LLM_PROVIDER, LlmProvider } from '@/shared/ai';
import { SdsSpecialistProfile, SdsSpecialistProfiles } from '@/modules/sds/sdsgeneration/agent/prompt';
import { SdsSectionDraftingAgent } from '@/modules/sds/sdsgeneration/agent/SdsSectionDraftingAgent';
import { SdsSpecialistDraftingAgent } from '@/modules/sds/sdsgeneration/agent/specialist/SdsSpecialistDraftingAgent';

/**
 * Equipo de redacción (patrón Factory): un {@link SdsSpecialistDraftingAgent} por perfil de
 * `SdsSpecialistProfiles`, creado una sola vez. Sumar una especialidad = sumar un perfil; ningún servicio cambia.
 * Para secciones sin especialista queda el redactor general.
 */
@Injectable()
export class SdsSpecialistDraftingAgents {
  private readonly byKey: ReadonlyMap<string, SdsSpecialistDraftingAgent>;

  constructor(
    @Inject(LLM_PROVIDER) llm: LlmProvider,
    settings: AgentSettings,
    private readonly general: SdsSectionDraftingAgent,
  ) {
    this.byKey = new Map(
      SdsSpecialistProfiles.all().map((profile) => [
        profile.key,
        new SdsSpecialistDraftingAgent(llm, settings, profile),
      ]),
    );
  }

  /** El especialista de esas secciones (el que comparte más con ellas) o, si no hay, el redactor general. */
  forSections(sections: readonly number[]): SdsSectionDraftingAgent {
    const profile = SdsSpecialistProfiles.forSections(sections);
    return (profile && this.byKey.get(profile.key)) ?? this.general;
  }

  forProfile(profile: SdsSpecialistProfile): SdsSpecialistDraftingAgent | undefined {
    return this.byKey.get(profile.key);
  }

  all(): readonly SdsSpecialistDraftingAgent[] {
    return [...this.byKey.values()];
  }
}

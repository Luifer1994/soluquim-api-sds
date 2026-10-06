/* eslint-disable */
/**
 * Compara modelos para el agente redactor con el flujo REAL (RAG + prompt + validación), sobre un solo
 * grupo de secciones para gastar poco. Uso (dentro del contenedor, con el código ya compilado en dist/):
 *
 *   node scripts/eval-drafting-models.js <modelo1,modelo2,…> [cas=50-00-0] [secciones=4,5,6]
 *
 * Imprime por modelo: validez del JSON, tokens, costo, tiempo, campos llenos, valores sin cita y citas inventadas, y
 * guarda las respuestas completas en /tmp/eval-<modelo>.json para leerlas.
 */
const fs = require('node:fs');
const { NestFactory } = require('@nestjs/core');

async function main() {
  const [modelsArg, cas = '50-00-0', sectionsArg = '4,5,6'] = process.argv.slice(2);
  if (!modelsArg) throw new Error('Uso: node scripts/eval-drafting-models.js <modelo1,modelo2> [cas] [secciones]');
  const sections = sectionsArg.split(',').map(Number);

  const { AppModule } = require('../dist/AppModule');
  const { LLM_PROVIDER } = require('../dist/shared/ai');
  const { BuildSectionContextService, SdsSectionCatalog } = require('../dist/modules/knowledge');
  const { ListCurrentSourceDataService } = require('../dist/modules/substance');
  const { SdsSectionDraftingAgent, SdsSpecialistProfiles } = require('../dist/modules/sds/sdsgeneration/agent');
  const { SectionSuggestionBuilder } = require('../dist/modules/sds/sdsgeneration/assembler');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const search = await app.get(BuildSectionContextService).execute({ casList: [cas], sections });
  const current = await app.get(ListCurrentSourceDataService).execute({ cas });
  const refs = new Map((search.data ?? []).map((hit, i) => [`K${i + 1}`, hit]));
  const input = {
    language: 'es',
    destinationCountry: 'CO',
    components: [{ cas, name: current.data?.substanceName ?? null, percentage: 100 }],
    sections: sections.map((n) => SdsSectionCatalog.forProduct(n, 'substance')),
    specialist: SdsSpecialistProfiles.forSections(sections),
    knowledge: [...refs].map(([ref, hit]) => ({ ref, source: hit.source, cas: hit.cas, title: hit.title, content: hit.content, relevance: hit.relevance })),
  };
  const count = (r) => [...refs.values()].filter((f) => f.relevance === r).length;
  const chars = [...refs.values()].reduce((sum, f) => sum + f.content.length, 0);
  console.log(`CAS ${cas} · secciones ${sections.join(',')} · ${refs.size} fragmentos (núcleo ${count('core')}, principales ${count('section')}, relacionados ${count('related')}) · ${chars} caracteres · fuentes: ${[...new Set([...refs.values()].map((f) => f.source))].join(', ')}\n`);

  for (const model of modelsArg.split(',')) {
    const agent = new SdsSectionDraftingAgent(app.get(LLM_PROVIDER), { modelFor: () => model, temperature: 0.2, maxOutputTokens: 6000 });
    const startedAt = Date.now();
    try {
      const result = await agent.run(input);
      const suggestions = SectionSuggestionBuilder.mergeDrafts(result.output.sections).map((draft) => SectionSuggestionBuilder.fromAgent(SdsSectionCatalog.forProduct(draft.number, 'substance'), draft, refs, 'es'));
      const fields = suggestions.flatMap((s) => s.subsections.flatMap((sub) => sub.fields));
      const sum = (pick) => suggestions.reduce((total, s) => total + pick(s).length, 0);
      console.log(
        `${model}\n  OK · ${((Date.now() - startedAt) / 1000).toFixed(1)} s · ${result.usage.promptTokens}+${result.usage.completionTokens} tokens · ` +
          `US$ ${(result.usage.cost ?? 0).toFixed(5)} · secciones ${suggestions.length}/${sections.length} · ` +
          `campos con dato ${fields.filter((f) => f.value).length}/${fields.length} · sin cita (descartados) ${sum((s) => s.discarded)} · ` +
          `citas inventadas ${sum((s) => s.invalidRefs)} · confianza ${result.output.sections.map((s) => s.confidence).join('/')}`,
      );
      suggestions.forEach((s) => console.log(`\n${s.content}`));
      fs.writeFileSync(`/tmp/eval-${model.replace(/[^a-z0-9.-]/gi, '_')}.json`, JSON.stringify(result.output, null, 2));
    } catch (error) {
      console.log(`${model}\n  FALLÓ · ${((Date.now() - startedAt) / 1000).toFixed(1)} s · ${String(error.message ?? error).slice(0, 220)}`);
    }
  }
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

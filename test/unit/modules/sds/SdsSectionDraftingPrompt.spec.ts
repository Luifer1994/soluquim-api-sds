import { SdsSectionCatalog } from '@/modules/knowledge';
import { buildSystemPrompt, buildUserPrompt } from '@/modules/sds/sdsgeneration/agent/prompt/SdsSectionDraftingPrompt';
import { CountryRegulatoryProfiles } from '@/modules/sds/sdsgeneration/country';

const mixture = [
  { cas: '64-17-5', name: 'Etanol', percentage: 99 },
  { cas: '77-09-8', name: 'Fenolftaleína', percentage: 1 },
];

describe('Prompt del agente redactor (v11)', () => {
  it('incluye las reglas del procedimiento: frases prohibidas, "No aplica", documentos del producto y mezclas', () => {
    const system = buildSystemPrompt();
    expect(system).toContain('FRASES PROHIBIDAS');
    expect(system).toContain('No aplica: <motivo>');
    expect(system).toContain('DOCUMENTOS DEL PRODUCTO');
    expect(system).toContain('MEZCLAS Y CONCENTRACIONES');
  });

  it('arma los bloques de país, mezcla, documentos del producto y referencia solo cuando hay datos', () => {
    const user = buildUserPrompt({
      language: 'es',
      destinationCountry: 'CO',
      components: mixture,
      sections: [SdsSectionCatalog.forProduct(14, 'mixture')],
      knowledge: [],
      productDocuments: [
        {
          ref: 'D1',
          title: 'FDS Etanol (Merck) · p. 11',
          kind: 'FDS del proveedor',
          component: 'Etanol (CAS 64-17-5)',
          content: 'UN 1170',
        },
      ],
      references: [{ ref: 'R1', title: 'GRE 2024 · p. 155', category: 'GUIDE', content: 'Guía 127' }],
      mixtureRules: '- Fenolftaleína (CAS 77-09-8) 1 %:\n  · Carc. 1B (H350): límite específico → ALCANZA',
      country: CountryRegulatoryProfiles.find('co'),
    });
    expect(user).toContain('<mixture_rules>');
    expect(user).toContain('<country_rules>');
    expect(user).toContain('Decreto 1076 de 2015');
    expect(user).toContain('[D1] [FDS del proveedor · Etanol (CAS 64-17-5)] FDS Etanol (Merck) · p. 11');
    expect(user).toContain('[R1] [referencia: GUIDE] GRE 2024 · p. 155');

    const substance = buildUserPrompt({
      language: 'es',
      components: [mixture[0]],
      sections: [SdsSectionCatalog.forProduct(14, 'substance')],
      knowledge: [],
      mixtureRules: 'no debe salir en una sustancia',
    });
    expect(substance).not.toContain('<mixture_rules>');
    expect(substance).not.toContain('<product_documents>');
    expect(substance).not.toContain('<reference>');
  });
});

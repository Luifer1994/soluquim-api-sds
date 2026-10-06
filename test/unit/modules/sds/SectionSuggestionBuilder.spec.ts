import { KnowledgeSearchHit, SdsSectionCatalog } from '@/modules/knowledge';
import { CurrentSourceData } from '@/modules/substance';
import { NO_DATA, SdsSectionContentMapper, SdsSectionSuggestionDTO } from '@/modules/sds/sdsdocument';
import {
  ClassificationEndpointFiller,
  ComponentHazardProfile,
  DeterministicSectionBuilder,
  RegulatorySectionBuilder,
  SectionSuggestionBuilder,
  SourceFallbackFiller,
} from '@/modules/sds/sdsgeneration/assembler';
import { GenerateSdsRequestDTO } from '@/modules/sds/sdsgeneration/dto/request';

const hit = (source: string): KnowledgeSearchHit => ({
  id: 'x',
  cas: '64-17-5',
  source,
  title: `${source} · Ethanol`,
  content: '...',
  sdsSections: [10],
  sourceUrl: `https://${source.toLowerCase()}.example`,
  language: 'es',
  similarity: 0.8,
});
const refs = new Map([
  ['K1', hit('ICSC')],
  ['K2', hit('NIOSH_NPG')],
]);
const fieldsOf = (suggestion: SdsSectionSuggestionDTO) => suggestion.subsections.flatMap((sub) => sub.fields);

describe('SectionSuggestionBuilder.fromAgent', () => {
  const section = SdsSectionCatalog.get(10);
  const suggestion = SectionSuggestionBuilder.fromAgent(
    section,
    {
      number: 10,
      fields: [
        { key: 'reactivity', value: '  Reacciona con oxidantes fuertes.  ', sourceRefs: ['K1', 'k9', 'K1'] },
        { key: 'chemicalStability', value: 'Estable en condiciones normales.', sourceRefs: [] },
        { key: 'conditionsToAvoid', value: 'No disponible', sourceRefs: ['K2'] },
        { key: 'campoInventado', value: 'Dato de más', sourceRefs: ['K1'] },
      ],
      conflicts: [],
      confidence: 'medium',
    },
    refs,
    'es',
  );
  const byKey = new Map(fieldsOf(suggestion).map((field) => [field.key, field]));

  it('respeta la plantilla: mismos apartados y campos, en orden, y nada fuera de ella', () => {
    expect(suggestion.subsections.map((sub) => sub.code)).toEqual(section.subsections.map((sub) => sub.code));
    expect(fieldsOf(suggestion).map((field) => field.key)).toEqual(
      section.subsections.flatMap((sub) => sub.fields.map((field) => field.key)),
    );
    expect(byKey.has('campoInventado')).toBe(false);
  });

  it('valor con cita válida entra con su fuente; la referencia inventada se informa', () => {
    expect(byKey.get('reactivity')).toMatchObject({ value: 'Reacciona con oxidantes fuertes.', origin: 'agent' });
    expect(byKey.get('reactivity')!.citations.map((c) => `${c.ref}:${c.source}`)).toEqual(['K1:ICSC']);
    expect(suggestion.invalidRefs).toEqual(['K9']);
  });

  it('valor sin cita se descarta (queda vacío y se lista para el revisor)', () => {
    expect(byKey.get('chemicalStability')).toMatchObject({ value: null, origin: null, citations: [] });
    expect(suggestion.discarded).toEqual([
      { key: 'chemicalStability', label: 'Estabilidad química', value: 'Estable en condiciones normales.' },
    ]);
  });

  it('texto de relleno o campo no devuelto = vacío, y se muestra como "Sin datos disponibles"', () => {
    expect(byKey.get('conditionsToAvoid')).toMatchObject({ value: null, citations: [] });
    expect(suggestion.missingData).toHaveLength(fieldsOf(suggestion).length - 1);
    expect(suggestion.content).toContain('10.1 Reactividad\nReacciona con oxidantes fuertes.');
    expect(suggestion.content).toContain(`10.2 Estabilidad química\n${NO_DATA}`);
  });
});

describe('SectionSuggestionBuilder.mergeDrafts (el modelo repite una sección)', () => {
  const draft = (fields: Array<[string, string | null]>, confidence: 'high' | 'medium' | 'low') => ({
    number: 4,
    fields: fields.map(([key, value]) => ({ key, value, sourceRefs: value ? ['K1'] : [] })),
    conflicts: [],
    confidence,
  });

  it('une las entradas con el mismo número: ningún campo se pierde', () => {
    const [merged, ...rest] = SectionSuggestionBuilder.mergeDrafts([
      draft(
        [
          ['inhalation', 'Aire limpio'],
          ['symptoms', null],
        ],
        'high',
      ),
      draft(
        [
          ['inhalation', null],
          ['symptoms', 'Tos'],
        ],
        'high',
      ),
      draft(
        [
          ['inhalation', null],
          ['symptoms', null],
        ],
        'low',
      ),
    ]);
    expect(rest).toHaveLength(0);
    expect(merged.fields.map((f) => [f.key, f.value])).toEqual([
      ['inhalation', 'Aire limpio'],
      ['symptoms', 'Tos'],
    ]);
    expect(merged.confidence).toBe('high'); // la entrada vacía en "low" no baja la confianza
  });

  it('con datos en ambas, queda la confianza más baja y el primer valor', () => {
    const [merged] = SectionSuggestionBuilder.mergeDrafts([
      draft([['inhalation', 'Aire limpio']], 'high'),
      draft(
        [
          ['inhalation', 'Otro texto'],
          ['skin', 'Lavar'],
        ],
        'medium',
      ),
    ]);
    expect(merged.fields.map((f) => f.value)).toEqual(['Aire limpio', 'Lavar']);
    expect(merged.confidence).toBe('medium');
  });
});

describe('pictogramas (2.2)', () => {
  const build = (value: string | null) =>
    fieldsOf(
      SectionSuggestionBuilder.fromAgent(
        SdsSectionCatalog.get(2),
        { number: 2, fields: [{ key: 'pictograms', value, sourceRefs: ['K1'] }], conflicts: [], confidence: 'high' },
        refs,
        'es',
      ),
    ).find((field) => field.key === 'pictograms')!;

  it('vienen listos para pintar: código, nombre e imagen, sin repetir', () => {
    expect(build('GHS07; ghs02, GHS02').pictograms).toEqual([
      { code: 'GHS02', name: 'Llama' },
      { code: 'GHS07', name: 'Signo de exclamación' },
    ]);
    expect(build('GHS07; ghs02, GHS02').value).toBe('GHS02, GHS07');
  });

  it('sin dato: lista vacía (misma forma siempre); los demás campos no llevan la propiedad', () => {
    expect(build(null).pictograms).toEqual([]);
    const others = fieldsOf(
      SectionSuggestionBuilder.fromAgent(
        SdsSectionCatalog.get(10),
        { number: 10, fields: [], conflicts: [], confidence: 'low' },
        refs,
        'es',
      ),
    );
    expect(others.every((field) => !('pictograms' in field))).toBe(true);
  });
});

describe('SdsSectionContentMapper.applyChange (edición del revisor)', () => {
  const base = SectionSuggestionBuilder.fromAgent(
    SdsSectionCatalog.get(2),
    {
      number: 2,
      fields: [{ key: 'pictograms', value: 'GHS02', sourceRefs: ['K1'] }],
      conflicts: [],
      confidence: 'high',
    },
    refs,
    'es',
  );

  it('cambia el campo y recalcula texto, faltantes y pictogramas', () => {
    const edited = SdsSectionContentMapper.applyChange(
      base,
      'pictograms',
      {
        value: 'GHS02; GHS07',
        origin: 'user',
        citations: [],
      },
      'es',
    )!;
    const field = fieldsOf(edited).find((f) => f.key === 'pictograms')!;
    expect(field).toMatchObject({ value: 'GHS02, GHS07', origin: 'user', citations: [] });
    expect(field.pictograms!.map((p) => p.code)).toEqual(['GHS02', 'GHS07']);
    expect(edited.content).toContain('Pictogramas: GHS02, GHS07');

    const cleared = SdsSectionContentMapper.applyChange(
      edited,
      'pictograms',
      {
        value: null,
        origin: null,
        citations: [],
      },
      'es',
    )!;
    expect(cleared.missingData).toContain('Pictogramas');
    expect(cleared.content).toContain(`Pictogramas: ${NO_DATA}`);
  });

  it('plantilla cerrada: un campo que no existe no se agrega', () => {
    expect(
      SdsSectionContentMapper.applyChange(base, 'campoNuevo', { value: 'x', origin: 'user', citations: [] }, 'es'),
    ).toBeNull();
  });
});

describe('frases H/P y palabra de advertencia', () => {
  const build = (key: string, value: string, language = 'es') =>
    fieldsOf(
      SectionSuggestionBuilder.fromAgent(
        SdsSectionCatalog.get(2),
        { number: 2, fields: [{ key, value, sourceRefs: ['K1'] }], conflicts: [], confidence: 'high' },
        refs,
        language,
      ),
    ).find((field) => field.key === key)!;

  it('códigos → una frase por línea con su texto oficial en español, sin repetir', () => {
    const field = build('hazardStatements', 'H225: Highly flammable liquid and vapour.; H319, H225');
    expect(field.statements).toEqual([
      { code: 'H225', text: 'Líquido y vapores muy inflamables' },
      { code: 'H319', text: 'Provoca irritación ocular grave' },
    ]);
    expect(field.value).toBe('H225 Líquido y vapores muy inflamables\nH319 Provoca irritación ocular grave');
  });

  it('frases P combinadas y códigos fuera del catálogo se conservan', () => {
    const field = build('precautionaryStatements', 'P210, P303 + P361 + P353, P999');
    expect(field.statements!.map((s) => s.code)).toEqual(['P210', 'P303+P361+P353', 'P999']);
    expect(field.statements![2].text).toBeNull();
  });

  it('en otro idioma se conserva el texto que traía la fuente', () => {
    expect(build('hazardStatements', 'H225: Highly flammable liquid and vapour.', 'en').statements).toEqual([
      { code: 'H225', text: 'Highly flammable liquid and vapour.' },
    ]);
  });

  it('palabra de advertencia en el idioma de la ficha', () => {
    expect(build('signalWord', 'Danger').value).toBe('Peligro');
    expect(build('signalWord', 'PELIGRO', 'en').value).toBe('Danger');
  });
});

describe('plantilla por tipo de producto', () => {
  it('3.1 solo para sustancias y 3.2 solo para mezclas', () => {
    expect(SdsSectionCatalog.forProduct(3, 'substance').subsections.map((s) => s.code)).toEqual(['3.1']);
    expect(SdsSectionCatalog.forProduct(3, 'mixture').subsections.map((s) => s.code)).toEqual(['3.2']);
    expect(SdsSectionCatalog.forProduct(9, 'mixture').subsections).toHaveLength(2);
  });
});

describe('RegulatorySectionBuilder (sección 15 sin IA)', () => {
  const component = (cas: string, name: string, sources: unknown[]) =>
    ({ cas, substanceName: name, sources }) as unknown as CurrentSourceData;
  const ethanol = component('64-17-5', 'Ethanol', [
    {
      source: 'ECHA',
      status: 'OK',
      sourceUrl: 'https://echa.example',
      records: [
        {
          field: 'ghs.harmonised',
          label: 'H',
          value: [{ indexNumber: '603-002-00-5', atp: 'CLP00', status: 'In application', effectiveDate: '01-12-2010' }],
        },
        { field: 'regulatory.echaProcesses', label: 'P', value: ['REG_REGISTERED', 'CNL_HARMONISED'] },
      ],
    },
    {
      source: 'IARC',
      status: 'OK',
      records: [
        {
          field: 'carcinogenicity.iarc',
          label: 'I',
          value: [{ agent: 'Ethanol in alcoholic beverages', group: '1', volumes: ['96'], publicationYear: 2012 }],
        },
      ],
    },
    {
      source: 'ICSC',
      status: 'FAILED',
      records: [{ field: 'regulatory.additionalInformation', label: 'A', value: 'x' }],
    },
  ]);

  it('vuelca lo que traen las fuentes, citado; lo que ninguna trae queda vacío', () => {
    const byKey = new Map(
      fieldsOf(RegulatorySectionBuilder.section15([ethanol], 'substance', 'es')).map((field) => [field.key, field]),
    );
    expect(byKey.get('euHarmonisedClassification')).toMatchObject({
      value: 'No. de índice 603-002-00-5 · CLP00 · In application · desde 01-12-2010',
      origin: 'source',
    });
    expect(byKey.get('euHarmonisedClassification')!.citations[0]).toMatchObject({
      source: 'ECHA',
      cas: '64-17-5',
      sourceUrl: 'https://echa.example',
    });
    expect(byKey.get('euRegulatoryProcesses')!.value).toBe('CNL_HARMONISED, REG_REGISTERED');
    expect(byKey.get('carcinogenListings')!.value).toBe(
      'IARC Grupo 1 · Ethanol in alcoholic beverages · Monografías vol. 96 · 2012',
    );
    expect(byKey.get('otherRegulations')!.value).toBeNull(); // la fuente falló: no se usa
    expect(byKey.get('chemicalSafetyAssessment')!.value).toBeNull();
  });

  it('en una mezcla cada dato se atribuye a su componente', () => {
    const water = component('7732-18-5', 'Water', []);
    const field = fieldsOf(RegulatorySectionBuilder.section15([ethanol, water], 'mixture', 'es')).find(
      (f) => f.key === 'euRegulatoryProcesses',
    )!;
    expect(field.value).toBe('Ethanol (CAS 64-17-5):\nCNL_HARMONISED, REG_REGISTERED');
  });
});

describe('SourceFallbackFiller (lo que el agente dejó vacío y la fuente sí trae)', () => {
  const component = (cas: string, name: string, inhalation: string) =>
    ({
      cas,
      substanceName: name,
      sources: [
        {
          source: 'ICSC',
          status: 'OK',
          sourceUrl: 'https://icsc.example',
          records: [
            { field: 'firstAid.byRoute', label: 'Primeros auxilios', value: { inhalation, skin: 'Lavar con agua.' } },
            { field: 'physical.flashPoint', label: 'Punto de inflamación', value: '12°C' },
          ],
        },
      ],
    }) as unknown as CurrentSourceData;
  const ethanol = component('64-17-5', 'Ethanol', 'Aire limpio, reposo.');
  const drafted = SectionSuggestionBuilder.fromAgent(
    SdsSectionCatalog.get(4),
    {
      number: 4,
      fields: [{ key: 'skin', value: 'Texto del agente', sourceRefs: ['K1'] }],
      conflicts: [],
      confidence: 'low',
    },
    refs,
    'es',
  );
  const byKey = (suggestion: SdsSectionSuggestionDTO | null) =>
    new Map(fieldsOf(suggestion!).map((field) => [field.key, field]));

  it('llena el campo vacío con el dato de la fuente, citado; no pisa lo del agente', () => {
    const fields = byKey(
      SourceFallbackFiller.fill({
        number: 4,
        suggestion: drafted,
        components: [ethanol],
        productKind: 'substance',
        language: 'es',
      }),
    );
    expect(fields.get('inhalation')).toMatchObject({ value: 'Aire limpio, reposo.', origin: 'source' });
    expect(fields.get('inhalation')!.citations[0]).toMatchObject({ source: 'ICSC', cas: '64-17-5' });
    expect(fields.get('skin')).toMatchObject({ value: 'Texto del agente', origin: 'agent' });
    expect(fields.get('eyes')!.value).toBeNull(); // la fuente no lo trae
  });

  it('si el agente falló, la sección se arma igual con lo que traen las fuentes, por componente', () => {
    const acetone = component('67-64-1', 'Acetone', 'Aire limpio.');
    const fields = byKey(
      SourceFallbackFiller.fill({
        number: 4,
        suggestion: null,
        components: [acetone, ethanol],
        productKind: 'mixture',
        language: 'es',
      }),
    );
    expect(fields.get('inhalation')!.value).toBe('Acetone: Aire limpio.\nEthanol: Aire limpio, reposo.');
  });

  it('texto en español solo para fichas en español; los datos numéricos valen en cualquier idioma', () => {
    const first = SourceFallbackFiller.fill({
      number: 4,
      suggestion: null,
      components: [ethanol],
      productKind: 'substance',
      language: 'en',
    });
    expect(first).toBeNull();
    const physical = byKey(
      SourceFallbackFiller.fill({
        number: 9,
        suggestion: null,
        components: [ethanol],
        productKind: 'substance',
        language: 'en',
      }),
    );
    expect(physical.get('flashPoint')).toMatchObject({ value: '12°C', origin: 'source' });
  });
});

describe('ClassificationEndpointFiller (sección 11: lo que dice la clasificación armonizada)', () => {
  const component = (cas: string, name: string, harmonised: unknown[]) =>
    ({
      cas,
      substanceName: name,
      sources: [
        {
          source: 'ECHA',
          status: 'OK',
          sourceUrl: 'https://echa.example',
          records: [{ field: 'ghs.harmonised', label: 'H', value: harmonised }],
        },
      ],
    }) as unknown as CurrentSourceData;
  const ammonia = component('1336-21-6', 'Ammonium Hydroxide', [
    { hazardClasses: [{ code: 'Skin Corr. 1B', hazardStatements: [{ code: 'H314' }] }, { code: 'Aquatic Acute 1' }] },
  ]);
  const water = component('7732-18-5', 'Water', []);
  const drafted = SectionSuggestionBuilder.fromAgent(
    SdsSectionCatalog.get(11),
    {
      number: 11,
      fields: [{ key: 'acuteToxicity', value: 'DL50 oral, rata: 350 mg/kg', sourceRefs: ['K1'] }],
      conflicts: [],
      confidence: 'medium',
    },
    refs,
    'es',
  );
  const fill = (components: CurrentSourceData[], productKind: 'substance' | 'mixture') =>
    new Map(
      fieldsOf(
        ClassificationEndpointFiller.fill({
          number: 11,
          suggestion: drafted,
          components,
          productKind,
          language: 'es',
        })!,
      ).map((field) => [field.key, field]),
    );

  it('clase con entrada armonizada → la clase y su H; sin ella → "no clasificado", citado a ECHA', () => {
    const fields = fill([ammonia], 'substance');
    expect(fields.get('skinCorrosionIrritation')).toMatchObject({
      value: 'Clasificación armonizada (CLP, Anexo VI): Skin Corr. 1B — H314.',
      origin: 'source',
    });
    expect(fields.get('carcinogenicity')!.value).toBe(
      'No clasificado para este peligro en la clasificación armonizada (CLP, Anexo VI).',
    );
    expect(fields.get('carcinogenicity')!.citations[0]).toMatchObject({ source: 'ECHA', cas: '1336-21-6' });
  });

  it('no pisa lo que ya llenó el agente ni toca campos que no son clases de peligro', () => {
    const fields = fill([ammonia], 'substance');
    expect(fields.get('acuteToxicity')).toMatchObject({ value: 'DL50 oral, rata: 350 mg/kg', origin: 'agent' });
    expect(fields.get('additionalInformation')!.value).toBeNull();
  });

  it('solo habla de los componentes que tienen entrada armonizada', () => {
    expect(fill([ammonia, water], 'mixture').get('carcinogenicity')!.value).toBe(
      'Ammonium Hydroxide: No clasificado para este peligro en la clasificación armonizada (CLP, Anexo VI).',
    );
    expect(fill([water], 'substance').get('carcinogenicity')!.value).toBeNull();
  });
});

describe('ComponentHazardProfile.isInert (diluyentes sin clasificación)', () => {
  const component = (sources: unknown[]) => ({ cas: 'x', substanceName: 'X', sources }) as unknown as CurrentSourceData;
  const echa = (harmonised: unknown[], dominantClasses: unknown[]) => ({
    source: 'ECHA',
    status: 'OK',
    records: [
      { field: 'ghs.harmonised', label: 'H', value: harmonised },
      { field: 'ghs.notified', label: 'N', value: { dominant: { hazardClasses: dominantClasses } } },
    ],
  });

  it('agua: ECHA responde y nadie le asigna clases de peligro → inerte', () => {
    expect(ComponentHazardProfile.isInert(component([echa([], [])]))).toBe(true);
  });

  it('con clasificación armonizada, notificada o de la ICSC → no es inerte', () => {
    expect(ComponentHazardProfile.isInert(component([echa([{ hazardClasses: [{ code: 'Flam. Liq. 2' }] }], [])]))).toBe(
      false,
    );
    expect(ComponentHazardProfile.isInert(component([echa([], [{ code: 'Eye Irrit. 2' }])]))).toBe(false);
    const icsc = {
      source: 'ICSC',
      status: 'OK',
      records: [{ field: 'ghs.icsc', label: 'G', value: { pictograms: [{ code: 'GHS07' }] } }],
    };
    expect(ComponentHazardProfile.isInert(component([echa([], []), icsc]))).toBe(false);
  });

  it('ante la duda (ECHA no respondió) se trata como peligroso', () => {
    expect(ComponentHazardProfile.isInert(component([]))).toBe(false);
    expect(ComponentHazardProfile.isInert(component([{ source: 'ECHA', status: 'FAILED', records: [] }]))).toBe(false);
  });
});

describe('DeterministicSectionBuilder', () => {
  const request = (extra: Partial<GenerateSdsRequestDTO>): GenerateSdsRequestDTO => ({
    components: [{ cas: '64-17-5', percentage: 100 }],
    language: 'es',
    ...extra,
  });

  it('sección 1: solo lo que mandó el usuario; lo demás queda vacío', () => {
    const suggestion = DeterministicSectionBuilder.section1(request({ product: { name: 'Etanol 96 %' } }), 'substance');
    const byKey = new Map(fieldsOf(suggestion).map((field) => [field.key, field]));

    expect(byKey.get('productName')).toMatchObject({ value: 'Etanol 96 %', origin: 'request' });
    expect(byKey.get('casNumber')).toMatchObject({ value: '64-17-5', origin: 'request' });
    expect([...byKey.keys()]).toEqual(['productName', 'casNumber']);
    expect(suggestion.confidence).toBeNull();
  });

  it('sección 1 de una mezcla: CAS solo si el producto tiene uno propio', () => {
    const suggestion = DeterministicSectionBuilder.section1(
      request({
        components: [
          { cas: '64-17-5', percentage: 70 },
          { cas: '7732-18-5', percentage: 30 },
        ],
      }),
      'mixture',
    );
    const byKey = new Map(fieldsOf(suggestion).map((field) => [field.key, field]));
    expect(byKey.get('casNumber')!.value).toBeNull();
    expect(byKey.get('productName')!.value).toBeNull();

    const withCas = DeterministicSectionBuilder.section1(
      request({
        components: [
          { cas: '64-17-5', percentage: 70 },
          { cas: '7732-18-5', percentage: 30 },
        ],
        product: { name: 'Mezcla X', cas: '8013-52-3' },
      }),
      'mixture',
    );
    expect(fieldsOf(withCas).map((field) => field.value)).toEqual(['Mezcla X', '8013-52-3']);
  });

  it('sección 16: fecha y fuentes consultadas (solo las que respondieron), con el texto oficial de las frases H citadas', () => {
    const current = [
      {
        cas: '64-17-5',
        substanceName: 'Ethanol',
        sources: [
          { source: 'ICSC', status: 'OK', records: [{ field: 'meta.attribution', label: 'A', value: 'OIT/OMS' }] },
          { source: 'NIST', status: 'OK', records: [] },
          { source: 'IARC', status: 'NOT_FOUND', records: [] },
        ],
      },
    ] as unknown as CurrentSourceData[];
    const section2 = SectionSuggestionBuilder.fromAgent(
      SdsSectionCatalog.get(2),
      {
        number: 2,
        fields: [{ key: 'hazardStatements', value: 'H319, H225', sourceRefs: ['K1'] }],
        conflicts: [],
        confidence: 'high',
      },
      refs,
      'es',
    );
    const suggestion = DeterministicSectionBuilder.section16({
      generatedAt: new Date('2026-10-02T15:00:00Z'),
      language: 'es',
      productKind: 'substance',
      components: current,
      sections: new Map([[2, section2]]),
    });
    const byKey = new Map(fieldsOf(suggestion).map((field) => [field.key, field]));

    expect(byKey.get('preparationDate')).toMatchObject({ value: '2026-10-02', origin: 'system' });
    expect(byKey.get('dataSources')!.value).toBe('ICSC — OIT/OMS\nNIST');
    // Texto oficial del catálogo, ordenado por código; nada escrito por la IA.
    expect(byKey.get('hStatementsFullText')!.value).toBe(
      'H225 Líquido y vapores muy inflamables\nH319 Provoca irritación ocular grave',
    );
  });
});

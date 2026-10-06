import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EchaParser, EchaSearchResponse } from '@/modules/source/parser';

const dir = join(__dirname, '../../../../fixtures/sources/echa');
const raw = (name: string) => readFileSync(join(dir, name), 'utf8');
const json = <T>(name: string): T => JSON.parse(raw(name)) as T;

describe('EchaParser (JSON real de ECHA CHEM)', () => {
  it('la búsqueda es aproximada: solo vale el CAS exacto', () => {
    const search = json<EchaSearchResponse>('formaldehyde_substance_search.json');
    expect((search.items ?? []).length).toBeGreaterThan(1);
    expect(EchaParser.pickSubstance(search, '50-00-0')).toMatchObject({ rmlId: '100.000.002', rmlCas: '50-00-0' });
  });

  it('CAS inexistente → sin sustancia', () => {
    expect(EchaParser.pickSubstance(json('unknown_cas_substance_search.json'), '99999-99-9')).toBeUndefined();
  });

  it('m-factors: cuerpo vacío = sin factores; con datos = acute/chronic', () => {
    expect(EchaParser.parseMFactors('')).toBeNull();
    expect(EchaParser.parseMFactors(raw('cypermethrin_harmonised_m-factors_35300.json'))).toEqual({
      classificationId: '35300',
      mfactorAcute: 100000,
      mfactorChronic: 100000,
    });
  });

  describe('clasificación armonizada del formaldehído (CLP Anexo VI)', () => {
    const [entry] = EchaParser.sortHarmonised(json('formaldehyde_harmonised_list.json'));
    const harmonised = EchaParser.parseHarmonised({
      entry,
      classification: json('formaldehyde_harmonised_classification.json'),
      labelling: json('formaldehyde_harmonised_labelling.json'),
      pictograms: json('formaldehyde_harmonised_pictograms.json'),
      specificConcentrationLimits: json('formaldehyde_harmonised_specific-concentration-limits.json'),
      mFactors: EchaParser.parseMFactors(raw('formaldehyde_harmonised_m-factors.json')),
      acuteToxicityEstimates: json('formaldehyde_harmonised_acute-toxicity-estimates.json'),
      notes: json('formaldehyde_harmonised_notes.json'),
    });

    it('clases y categorías con sus frases H', () => {
      expect(harmonised.indexNumber).toBe('605-001-00-5');
      expect(harmonised.hazardClasses.map((h) => h.code)).toEqual(expect.arrayContaining(['Carc. 1B', 'Muta. 2']));
      expect(harmonised.hazardClasses.find((h) => h.code === 'Carc. 1B')?.hazardStatements[0].code).toBe('H350');
    });

    it('etiquetado: palabra de advertencia y pictogramas', () => {
      expect(harmonised.signalWord).toBe('Danger');
      expect(harmonised.pictograms.map((p) => p.code)).toEqual(['GHS08', 'GHS06', 'GHS05']);
    });

    it('límites de concentración específicos (los usa el cálculo de la mezcla)', () => {
      expect(harmonised.specificConcentrationLimits).toEqual(
        expect.arrayContaining([
          { range: 'C ≥ 5 %', hazardClasses: ['STOT SE 3'] },
          { range: 'C ≥ 25 %', hazardClasses: ['Skin Corr. 1B'] },
        ]),
      );
    });

    it('ETA por vía (fórmula de toxicidad aguda de la mezcla)', () => {
      expect(harmonised.acuteToxicityEstimates).toEqual(
        expect.arrayContaining([
          { route: 'Inhalation', value: 100, unit: 'ppmV', atmosphere: 'gases' },
          { route: 'Oral', value: 500, unit: 'mg/kg bw', atmosphere: undefined },
        ]),
      );
    });

    it('sin factores M → null; notas B y D', () => {
      expect(harmonised.mFactors).toBeNull();
      expect(harmonised.notes.map((n) => n.code)).toEqual(expect.arrayContaining(['B', 'D']));
    });
  });

  it('notificadas: la dominante (mayor % de notificantes) primero', () => {
    const sorted = EchaParser.sortNotified(json('formaldehyde_notified_list.json'));
    const percentages = sorted.map((n) => n.substanceNotificationPercentage ?? 0);
    expect(percentages).toEqual([...percentages].sort((a, b) => b - a));
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PubChemGhsResponse,
  PubChemParser,
  PubChemPropertiesResponse,
  PubChemSynonymsResponse,
} from '@/modules/source/parser';

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(__dirname, '../../../../fixtures/sources/pubchem', name), 'utf8')) as T;
const URL = 'https://pubchem.ncbi.nlm.nih.gov/compound/702';

describe('PubChemParser (JSON real de PubChem, etanol CID 702)', () => {
  const properties = fixture<PubChemPropertiesResponse>('702-properties.json');
  const synonyms = fixture<PubChemSynonymsResponse>('702-synonyms.json');
  const ghs = fixture<PubChemGhsResponse>('702-ghs.json');

  it('identidad normalizada', () => {
    const records = PubChemParser.parseIdentity(properties, synonyms, '64-17-5', URL);
    const value = (field: string) => records.find((r) => r.field === field)?.value;

    expect(value('identity.pubchemCid')).toBe(702);
    expect(value('identity.iupacName')).toBe('ethanol');
    expect(value('identity.molecularFormula')).toBe('C2H6O');
    expect(value('identity.molecularWeight')).toBe(46.07);
    expect(records.find((r) => r.field === 'identity.molecularWeight')?.unit).toBe('g/mol');
    expect(value('identity.casVerified')).toBe(true);
  });

  it('los sinónimos no incluyen códigos (CAS, EINECS…)', () => {
    const names = PubChemParser.parseIdentity(properties, synonyms, '64-17-5', URL).find(
      (r) => r.field === 'identity.synonyms',
    )?.value as string[];
    expect(names).toContain('ethyl alcohol');
    expect(names.some((n) => /^[\d-]+$/.test(n))).toBe(false);
  });

  it('casVerified=false si el CAS no está entre los sinónimos', () => {
    const records = PubChemParser.parseIdentity(properties, synonyms, '7732-18-5', URL);
    expect(records.find((r) => r.field === 'identity.casVerified')?.value).toBe(false);
  });

  describe('clasificaciones SGA', () => {
    const classifications = PubChemParser.parseGhsClassifications(ghs);

    it('la armonizada del CLP va primero', () => {
      expect(classifications[0].harmonized).toBe(true);
      expect(classifications[0].sourceName).toMatch(/^Regulation \(EC\) No 1272\/2008/);
      expect(classifications.filter((c) => c.harmonized)).toHaveLength(1);
    });

    it('armonizada del etanol: GHS02, Peligro, H225', () => {
      const [harmonized] = classifications;
      expect(harmonized.pictograms).toEqual([{ code: 'GHS02', name: 'Flammable' }]);
      expect(harmonized.signalWord).toBe('Danger');
      expect(harmonized.hazardStatements.map((h) => h.code)).toEqual(['H225']);
      expect(harmonized.precautionaryStatements).toContain('P303+P361+P353');
    });

    it('conserva las clasificaciones notificadas a ECHA con su % de reportes', () => {
      const notified = classifications.find((c) => !c.harmonized && c.hazardStatements.some((h) => h.code === 'H319'));
      expect(notified).toBeDefined();
      expect(notified!.hazardStatements.find((h) => h.code === 'H319')?.reportedPercentage).toBeGreaterThan(0);
    });

    it('sin sección SGA → lista vacía', () => {
      expect(PubChemParser.parseGhsClassifications({})).toEqual([]);
    });
  });
});

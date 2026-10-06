import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OshaParser } from '@/modules/source/parser';

const fixture = (name: string) => readFileSync(join(__dirname, '../../../../fixtures/sources/osha', name), 'utf8');

describe('OshaParser (HTML real de la OSHA Occupational Chemical Database)', () => {
  it('búsqueda: solo filas con el CAS exacto', () => {
    expect(OshaParser.parseSearch(fixture('search_cas_64-17-5.html'), '64-17-5')).toEqual([
      { id: '1034', name: 'ETHYL ALCOHOL (ETHANOL)' },
    ]);
    expect(OshaParser.parseSearch(fixture('search_cas_9999-99-9.html'), '9999-99-9')).toEqual([]);
  });

  it('formaldehído: 2 entradas; prefiere la sustancia sobre la formalina', () => {
    const results = OshaParser.parseSearch(fixture('search_cas_50-00-0.html'), '50-00-0');
    expect(results.length).toBe(2);
    expect(OshaParser.pickBest(results)?.id).toBe('377');
  });

  describe('etanol', () => {
    const records = OshaParser.parseChemical(fixture('chem_1034.html'), 'u');
    const value = (field: string) => records.find((r) => r.field === field)?.value;

    it('límites por agencia', () => {
      expect(value('exposure.osha.oshaPel')).toMatchObject({ twa: '1000 ppm (1900 mg/m³)', skinNotation: 'N' });
      expect(value('exposure.osha.acgihTlv')).toMatchObject({ stel: '1000 ppm [2008]' });
      expect(value('exposure.idlh')).toMatch(/3300 ppm/);
    });

    it('propiedades físicas (°F)', () => {
      expect(value('physical.flashPoint')).toBe('55°F');
      expect(value('physical.boilingPoint')).toBe('173°F');
    });
  });

  it('formaldehído: clasificaciones de carcinogenicidad resumidas', () => {
    const records = OshaParser.parseChemical(fixture('chem_377.html'), 'u');
    expect(records.find((r) => r.field === 'carcinogenicity.summary')?.value).toEqual(
      expect.arrayContaining(['IARC-1', 'NIOSH-Ca']),
    );
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NistParser, NistValue } from '@/modules/source/parser';

const fixture = (name: string) => readFileSync(join(__dirname, '../../../../fixtures/sources/nist', name), 'utf8');
const URL = NistParser.pageUrl('64-17-5');

describe('NistParser (HTML real del NIST WebBook, etanol Mask=7)', () => {
  const records = NistParser.parse(fixture('combined_mask7_ethanol.html'), URL);
  const value = (field: string) => records.find((r) => r.field === field)?.value;

  it('URL: ID=C + dígitos del CAS, una sola página con todo', () => {
    expect(URL).toBe('https://webbook.nist.gov/cgi/cbook.cgi?ID=C64175&Units=SI&Mask=7');
  });

  it('identidad', () => {
    expect(value('identity.name')).toBe('Ethanol');
    expect(value('identity.inchiKey')).toBe('LFQSCWFLJHTTHZ-UHFFFAOYSA-N');
    expect(value('identity.cas')).toBe('64-17-5');
  });

  it('punto de ebullición en K con incertidumbre, convertido a °C', () => {
    const boiling = value('physical.boilingPoint') as NistValue;
    expect(boiling).toMatchObject({ value: 351.5, uncertainty: 0.2, unit: 'K', celsius: 78.35 });
  });

  it('constantes críticas y entalpías', () => {
    expect((value('thermo.criticalTemperature') as NistValue).unit).toBe('K');
    expect((value('thermo.enthalpyOfFormationGas') as NistValue).value).toBe(-234);
  });

  it('cita la fuente', () => {
    expect(value('meta.attribution')).toMatch(/SRD 69|Standard Reference Database 69/);
  });

  it('CAS inexistente', () => {
    expect(NistParser.isNotFound(fixture('unknown.html'))).toBe(true);
    expect(NistParser.isNotFound(fixture('combined_mask7_ethanol.html'))).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PubChemViewParser, PubChemViewResponse } from '@/modules/source/parser';

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../../../fixtures/sources/pubchem/view_702_excerpt.json'), 'utf8'),
) as PubChemViewResponse;
const URL = 'https://pubchem.ncbi.nlm.nih.gov/compound/702';

describe('PubChemViewParser (registro completo de PubChem, etanol)', () => {
  const records = PubChemViewParser.parse([fixture], URL);
  const byField = new Map(records.map((record) => [record.field, record]));

  it('lleva cada apartado útil a su campo normalizado y descarta el resto', () => {
    expect([...byField.keys()].sort()).toEqual([
      'disposal.methods',
      'ecology.ecotoxicity',
      'firstAid.measures',
      'physical.flashPoint',
      'transport.shippingName',
    ]);
  });

  it('cada dato conserva la colección de origen como cita', () => {
    const shipping = byField.get('transport.shippingName')!.value as string[];
    expect(shipping[0]).toBe(
      'UN 1170; Ethanol or Ethyl alcohol or Ethanol solutions or Ethyl alcohol solutions [HSDB]',
    );
    expect(byField.get('transport.shippingName')!.sourceUrl).toContain(`${URL}#section=`);
  });

  it('no repite lo que ya se consulta como fuente propia (ICSC, NIOSH)', () => {
    expect(byField.has('transport.unClassification')).toBe(false); // el único dato era de la ICSC
    const all = records.flatMap((record) => record.value as string[]).join(' ');
    expect(all).not.toMatch(/ICSC|NIOSH/);
  });

  it('limita cuántos datos guarda por apartado y el largo de cada uno', () => {
    for (const record of records) {
      const items = record.value as string[];
      expect(items.length).toBeLessThanOrEqual(5);
      expect(items.every((item) => item.length <= 760)).toBe(true);
    }
  });

  it('reparte los cupos entre colecciones distintas', () => {
    const flash = (byField.get('physical.flashPoint')!.value as string[]).map(
      (item) => item.match(/\[([^\]]+)\]$/)?.[1],
    );
    expect(new Set(flash).size).toBeGreaterThan(1);
  });
});

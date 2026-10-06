import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InsstLepParser } from '@/modules/source/parser';

const fixture = (name: string) => readFileSync(join(__dirname, '../../../../fixtures/sources/insst', name), 'utf8');

describe('InsstLepParser (HTML real de bdlep.insst.es)', () => {
  it('búsqueda por CAS → ficha del agente', () => {
    expect(InsstLepParser.parseSearch(fixture('bdlep_search_64-17-5.html'), '64-17-5')).toBe(
      'vlapr.jsp?ID=411&nombre=Etanol',
    );
    expect(InsstLepParser.parseSearch(fixture('bdlep_search_unknown.html'), '99999-99-9')).toBeUndefined();
  });

  it('etanol: sin VLA-ED, VLA-EC 1000 ppm / 1910 mg/m³', () => {
    const records = InsstLepParser.parseAgent(fixture('bdlep_vla_411_etanol.html'), 'u');
    const value = (field: string) => records.find((r) => r.field === field)?.value;
    expect(value('identity.name')).toBe('Etanol');
    expect(value('exposure.oel.es')).toEqual({
      vlaEd: { ppm: null, mgM3: null },
      vlaEc: { ppm: '1000 ppm', mgM3: '1910 mg/m3' },
    });
    expect(value('ghs.hazardStatementCodes')).toEqual(['H225']);
  });

  it('acetona: VLA-ED 500 ppm, frases H y notas VLB/VLI', () => {
    const records = InsstLepParser.parseAgent(fixture('bdlep_vla_33_acetona.html'), 'u');
    const value = (field: string) => records.find((r) => r.field === field)?.value;
    expect((value('exposure.oel.es') as { vlaEd: unknown }).vlaEd).toEqual({ ppm: '500 ppm', mgM3: '1210 mg/m3' });
    expect(value('ghs.hazardStatementCodes')).toEqual(['H225', 'H319', 'H336', 'EUH066']);
    expect((value('regulatory.insstNotes') as Array<{ code: string }>).map((n) => n.code)).toEqual(['VLB®', 'VLI']);
  });
});

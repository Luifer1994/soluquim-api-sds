import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CompToxHazardResponse,
  CompToxParser,
  CompToxPropertiesResponse,
  CompToxSearchResponseItem,
} from '@/modules/source/parser';

const json = <T>(name: string): T =>
  JSON.parse(readFileSync(join(__dirname, '../../../../fixtures/sources/comptox', name), 'utf8')) as T;
const URL = 'https://comptox.epa.gov/dashboard/chemical/details/DTXSID9020584';

describe('CompToxParser (JSON real del CompTox Dashboard, etanol)', () => {
  it('elige el químico con el CAS exacto', () => {
    const items = json<CompToxSearchResponseItem[]>('search_equal-with-detail_64-17-5.json');
    expect(CompToxParser.pickByCas(items, '64-17-5')?.dtxsid).toBe('DTXSID9020584');
    expect(CompToxParser.pickByCas(items, '7732-18-5')).toBeUndefined();
  });

  it('propiedades: experimental y predicho por separado', () => {
    const records = CompToxParser.parseProperties(
      json<CompToxPropertiesResponse>('chemical-property_DTXSID9020584.json'),
      URL,
    );
    const boiling = records.find((r) => r.field === 'physical.boilingPoint');
    expect(boiling?.unit).toBe('°C');
    expect(boiling?.value).toMatchObject({ experimental: { median: 78, count: 7 }, predicted: { count: 4 } });
    expect(records.find((r) => r.field === 'physical.logPow')).toBeDefined();
  });

  it('toxicidad aguda: DL50 oral en rata con el valor más bajo y sus fuentes', () => {
    const [record] = CompToxParser.parseAcuteToxicity(
      json<CompToxHazardResponse>('hazard_DTXSID9020584_trimmed.json'),
      URL,
    );
    const groups = record.value as Array<{
      type: string;
      route: string;
      species: string;
      lowest: number;
      values: unknown[];
    }>;
    const oralRat = groups.find((g) => g.type === 'LD50' && g.route === 'oral' && g.species === 'Rat');
    expect(oralRat).toBeDefined();
    expect(oralRat!.lowest).toBeGreaterThan(0);
    expect(oralRat!.values.length).toBeGreaterThan(0);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NioshNpgParser } from '@/modules/source/parser';

const fixture = (name: string) => readFileSync(join(__dirname, '../../../../fixtures/sources/niosh', name), 'utf8');
const URL = 'https://www.cdc.gov/niosh/npg/npgd0262.html';

describe('NioshNpgParser (HTML real de la NIOSH Pocket Guide)', () => {
  describe('parseCasIndex', () => {
    const index = NioshNpgParser.parseCasIndex(fixture('npgdcas-excerpt.html'));

    it('mapea CAS → ficha', () => {
      expect(index.get('64-17-5')).toEqual([{ page: 'npgd0262.html', name: 'Ethyl alcohol' }]);
    });

    it('guarda todas las fichas de un CAS que tiene varias', () => {
      expect(index.get('1309-37-1')!.length).toBeGreaterThan(1);
    });

    it('ignora filas que no son un CAS', () => {
      expect(index.has('no-es-cas')).toBe(false);
    });
  });

  describe('parseChemicalPage (etanol)', () => {
    const records = NioshNpgParser.parseChemicalPage(fixture('npgd0262-ethanol.html'), URL);
    const value = (field: string) => records.find((r) => r.field === field)?.value;

    it('identidad', () => {
      expect(value('identity.name')).toBe('Ethyl alcohol');
      expect(value('identity.cas')).toBe('64-17-5');
      expect(value('identity.synonyms')).toEqual(['Alcohol', 'Cologne spirit', 'Ethanol', 'EtOH', 'Grain alcohol']);
    });

    it('límites de exposición (sección 8), sin enlaces "See:" ni espacios de <sup>', () => {
      expect(value('exposure.nioshRel')).toBe('TWA 1000 ppm (1900 mg/m3)');
      expect(value('exposure.oshaPel')).toBe('TWA 1000 ppm (1900 mg/m3)');
      expect(value('exposure.idlh')).toBe('3300 ppm [10%LEL]');
      expect(value('exposure.conversion')).toBe('1 ppm = 1.89 mg/m3');
    });

    it('número ONU y guía ERG separados (sección 14)', () => {
      expect(value('transport.unNumber')).toBe('1170');
      expect(value('transport.ergGuide')).toBe('127');
    });

    it('propiedades físicas (sección 9)', () => {
      expect(value('physical.flashPoint')).toBe('55°F');
      expect(value('physical.boilingPoint')).toBe('173°F');
      expect(value('physical.lowerExplosiveLimit')).toBe('3.3%');
    });

    it('primeros auxilios y EPP como clave/valor', () => {
      expect(value('firstAid.measures')).toMatchObject({ Eye: 'Irrigate immediately', Breathing: 'Fresh air' });
      expect(value('protection.personal')).toMatchObject({ Skin: 'Prevent skin contact' });
    });

    it('respirador: un párrafo por recomendación, sin textos pegados', () => {
      const respirator = value('protection.respirator') as string[];
      expect(respirator[0]).toBe('NIOSH/OSHA');
      expect(respirator[1]).toMatch(/^Up to 3300 ppm:/);
    });

    it('cada dato apunta a la URL de la ficha', () => {
      expect(records.every((r) => r.sourceUrl === URL)).toBe(true);
    });

    it('no pierde tarjetas desconocidas: salen como other.*', () => {
      expect(records.some((r) => r.field.startsWith('other.'))).toBe(true);
    });
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IcscParser } from '@/modules/source/parser';

const fixture = (name: string) => readFileSync(join(__dirname, '../../../../fixtures/sources/icsc', name), 'utf8');
const URL = 'https://chemicalsafety.ilo.org/dyn/icsc/showcard.display?p_lang=es&p_card_id=0044&p_version=2';

describe('IcscParser (HTML real de la ICSC)', () => {
  describe('búsqueda por CAS', () => {
    it('encuentra la ficha del etanol', () => {
      expect(IcscParser.parseSearch(fixture('search_cas_64-17-5.html'))).toEqual([
        expect.objectContaining({ cardId: '0044', version: '2' }),
      ]);
    });

    it('formaldehído: dos fichas; elige la de la sustancia pura, no la solución al 37 %', () => {
      const results = IcscParser.parseSearch(fixture('search_cas_50-00-0.html'));
      expect(results.length).toBe(2);
      expect(IcscParser.pickBest(results)?.cardId).toBe('0275');
    });

    it('CAS inexistente: sin resultados', () => {
      expect(IcscParser.parseSearch(fixture('search_cas_9999-99-9.html'))).toEqual([]);
    });

    it('detecta "Card not found"', () => {
      expect(IcscParser.isCardNotFound(fixture('card_9999_en.html'))).toBe(true);
      expect(IcscParser.isCardNotFound(fixture('card_0044_es.html'))).toBe(false);
    });
  });

  describe('ficha del etanol en español', () => {
    const records = IcscParser.parseCard(fixture('card_0044_es.html'), URL, 'es');
    const value = (field: string) => records.find((r) => r.field === field)?.value;

    it('identidad y transporte', () => {
      expect(value('identity.name')).toBe('ETANOL (ANHIDRO)');
      expect(value('identity.cas')).toBe('64-17-5');
      expect(value('identity.ecNumber')).toBe('200-578-6');
      expect(value('transport.unNumber')).toBe('1170');
      expect(value('transport.unHazardClass')).toBe('3');
      expect(value('transport.packingGroup')).toBe('II');
      expect(value('identity.synonyms')).toContain('Alcohol etílico');
    });

    it('incendio (sección 5) en español', () => {
      expect(value('fire.extinguishing')).toMatch(/^Usar agua pulverizada, polvo, espuma resistente al alcohol/);
      expect(value('fire.hazards')).toMatch(/^Altamente inflamable/);
    });

    it('primeros auxilios por vía (sección 4)', () => {
      expect(value('firstAid.byRoute')).toEqual({
        inhalation: 'Aire limpio, reposo.',
        skin: expect.stringMatching(/^Quitar las ropas contaminadas/),
        eyes: expect.stringMatching(/^Enjuagar con agua abundante/),
        ingestion: expect.stringMatching(/^Enjuagar la boca/),
      });
      expect(value('exposure.generalWarning')).toMatch(/HIGIENE ESTRICTA/);
    });

    it('derrames, almacenamiento y medio ambiente (secciones 6, 7, 12)', () => {
      expect(value('spill.measures')).toMatch(/^Eliminar toda fuente de ignición/);
      expect(value('storage.conditions')).toMatch(/^A prueba de incendio/);
      expect(value('ecology.environment')).toMatch(/no se ha encontrado ninguno significativo/);
    });

    it('SGA: pictogramas como códigos, palabra de advertencia y frases', () => {
      const ghs = value('ghs.icsc') as {
        pictograms: Array<{ code: string }>;
        signalWord: string;
        hazardStatements: string[];
      };
      expect(ghs.pictograms.map((p) => p.code)).toEqual(['GHS02', 'GHS07', 'GHS08']);
      expect(ghs.signalWord).toBe('PELIGRO');
      expect(ghs.hazardStatements).toContain('Líquido y vapores muy inflamables');
    });

    it('propiedades físico-químicas (sección 9)', () => {
      expect(value('physical.boilingPoint')).toBe('78°C');
      expect(value('physical.flashPoint')).toBe('12.0 °C c.c.');
      expect(value('physical.autoIgnitionTemperature')).toBe('400°C');
      expect(value('physical.relativeDensity')).toBe('0.79');
      expect(value('physical.relativeVaporDensity')).toBe('1.6');
      expect(value('physical.logPow')).toBe('-0.32');
      expect(value('identity.formula')).toBe('CH3CH2OH / C2H6O');
      expect(value('reactivity.chemicalDangers')).toMatch(/^Reacciona lentamente con hipoclorito/);
    });

    it('efectos sobre la salud (sección 11) y límites de exposición (sección 8)', () => {
      expect(value('health.shortTermEffects')).toMatch(/irrita gravemente los ojos/);
      expect(value('exposure.occupationalLimits')).toEqual([
        expect.stringMatching(/^TLV: 1000 ppm como STEL/),
        expect.stringMatching(/^MAK: 380 mg\/m3, 200 ppm/),
      ]);
    });

    it('incluye los límites del INSST (España) en información adicional', () => {
      expect(value('regulatory.additionalInformation')).toMatch(/VLA-EC: 1000 ppm/);
    });
  });

  it('la ficha en inglés se parsea con las mismas claves', () => {
    const records = IcscParser.parseCard(fixture('card_0044_en.html'), URL, 'en');
    const value = (field: string) => records.find((r) => r.field === field)?.value;
    expect(value('identity.name')).toBe('ETHANOL (ANHYDROUS)');
    expect(value('physical.boilingPoint')).toBe('78°C');
    expect((value('firstAid.byRoute') as Record<string, string>).inhalation).toBe('Fresh air, rest.');
    expect(value('transport.unNumber')).toBe('1170');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IarcParser } from '@/modules/source/parser';

const bundle = readFileSync(join(__dirname, '../../../../fixtures/sources/iarc/loc.app.js'), 'utf8');

describe('IarcParser (bundle real loc.app.js, leído como DATO)', () => {
  const dataset = IarcParser.parseBundle(bundle);
  const byCas = IarcParser.indexByCas(dataset);

  it('extrae el listado completo sin ejecutar el JS', () => {
    expect(dataset.agents.length).toBeGreaterThan(1000);
    expect(dataset.lastVolume).toMatch(/^\d+$/);
  });

  it('formaldehído: grupo 1', () => {
    expect(byCas.get('50-00-0')?.map((a) => a.group)).toEqual(['1']);
  });

  it('etanol: solo como "en bebidas alcohólicas"', () => {
    expect(byCas.get('64-17-5')?.[0]).toMatchObject({ name: 'Ethanol in alcoholic beverages', group: '1' });
  });

  it('un CAS puede tener varias evaluaciones (acetaldehído 2B y 1)', () => {
    expect(
      byCas
        .get('75-07-0')
        ?.map((a) => a.group)
        .sort(),
    ).toEqual(['1', '2B']);
  });

  it('los booleanos minificados (!0) se leen como true', () => {
    expect(dataset.agents.some((a) => a.in_prep === true)).toBe(true);
  });

  it('ignora las referencias cruzadas sin grupo', () => {
    expect([...byCas.values()].flat().every((agent) => agent.group)).toBe(true);
  });

  it('falla claro si cambia el bundle', () => {
    expect(() => IarcParser.parseBundle('console.log(1)')).toThrow(/No se encontró el listado/);
  });
});

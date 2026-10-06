import { isValidCas } from '@/shared/validation';

describe('isValidCas', () => {
  it.each([
    ['7732-18-5', 'agua'],
    ['64-17-5', 'etanol'],
    ['50-00-0', 'formaldehído'],
    ['7647-14-5', 'cloruro de sodio'],
    ['1310-73-2', 'hidróxido de sodio'],
  ])('acepta %s (%s)', (cas) => {
    expect(isValidCas(cas)).toBe(true);
  });

  it.each([
    ['50-00-1', 'dígito verificador incorrecto'],
    ['7732-18-4', 'dígito verificador incorrecto'],
    ['7732185', 'sin guiones'],
    ['1-00-0', 'primer bloque muy corto'],
    ['12345678-00-0', 'primer bloque muy largo'],
    ['', 'vacío'],
    ['abc-de-f', 'no numérico'],
  ])('rechaza %s (%s)', (cas) => {
    expect(isValidCas(cas)).toBe(false);
  });
});

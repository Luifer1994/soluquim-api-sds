import { contentHash, stableStringify } from '@/shared/util';

describe('contentHash', () => {
  it('no depende del orden de las claves', () => {
    expect(contentHash({ a: 1, b: { c: 2, d: 3 } })).toBe(contentHash({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('sí depende del orden de los arrays y de los valores', () => {
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });

  it('ignora claves undefined (igual que lo que se guarda en JSON)', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

import { escapeRegExp, foldText } from '@/shared/util';

/**
 * Frases que una FDS no puede llevar (procedimiento TR-P-01, requisitos generales; ECHA y GQSP coinciden):
 * juicios generales que minimizan el peligro. Se buscan sin distinguir mayúsculas ni tildes.
 */
const PROHIBITED_PHRASES: readonly string[] = [
  'puede ser peligroso',
  'sin efectos sobre la salud',
  'seguro en casi todas las condiciones de uso',
  'seguro si se usa bien',
  'inocuo',
  'inocua',
  'may be dangerous',
  'no health effects',
  'safe under almost all conditions of use',
  'safe if used properly',
  'harmless',
];

const PATTERNS = PROHIBITED_PHRASES.map(
  (phrase) => new RegExp(`(^|[^\\p{L}])${escapeRegExp(foldText(phrase))}($|[^\\p{L}])`, 'u'),
);

export class ProhibitedPhraseValidator {
  /** Separa las líneas que contienen una frase prohibida (función pura). */
  static strip(value: string | null): { value: string | null; removed: string[] } {
    if (!value) return { value, removed: [] };
    const removed: string[] = [];
    const kept = value.split('\n').filter((line) => {
      const prohibited = PATTERNS.some((pattern) => pattern.test(foldText(line)));
      if (prohibited) removed.push(line);
      return !prohibited;
    });
    return { value: kept.join('\n').trim() || null, removed };
  }
}

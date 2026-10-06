const CAS_PATTERN = /^(\d{2,7})-(\d{2})-(\d)$/;

/**
 * Valida un número CAS: formato `NNNNNNN-NN-N` y dígito verificador.
 *
 * El último dígito es un checksum: se toman los demás dígitos de derecha a izquierda, se multiplica
 * cada uno por su posición (1, 2, 3…) y la suma módulo 10 debe ser igual al dígito verificador.
 * Ej.: 7732-18-5 (agua) → 8·1 + 1·2 + 2·3 + 3·4 + 7·5 + 7·6 = 105 → 105 % 10 = 5 ✓
 */
export function isValidCas(cas: string): boolean {
  const match = CAS_PATTERN.exec(cas.trim());
  if (!match) return false;

  const digits = (match[1] + match[2]).split('').reverse().map(Number);
  const sum = digits.reduce((acc, digit, index) => acc + digit * (index + 1), 0);
  return sum % 10 === Number(match[3]);
}

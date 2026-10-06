export interface GhsPictogram {
  /** Código SGA: GHS01 … GHS09. */
  code: string;
  name: string;
}

const PICTOGRAMS: Array<[code: string, name: string]> = [
  ['GHS01', 'Bomba explotando'],
  ['GHS02', 'Llama'],
  ['GHS03', 'Llama sobre círculo'],
  ['GHS04', 'Botella de gas'],
  ['GHS05', 'Corrosión'],
  ['GHS06', 'Calavera y tibias cruzadas'],
  ['GHS07', 'Signo de exclamación'],
  ['GHS08', 'Peligro para la salud'],
  ['GHS09', 'Medio ambiente'],
];

/**
 * Los 9 pictogramas del SGA (catálogo cerrado). El documento devuelve código + nombre; la imagen la
 * pone quien pinta (el front tiene los 9 íconos y los resuelve por código).
 */
export class GhsPictogramCatalog {
  private static readonly byCode = new Map<string, GhsPictogram>(
    PICTOGRAMS.map(([code, name]) => [code, { code, name }]),
  );

  static get(code: string): GhsPictogram | undefined {
    return GhsPictogramCatalog.byCode.get(code.toUpperCase());
  }

  /** Códigos GHS0x que aparecen en un texto, sin repetir y en orden de código. */
  static fromText(text: string | null | undefined): GhsPictogram[] {
    const codes = new Set((text ?? '').toUpperCase().match(/GHS0[1-9]/g) ?? []);
    return [...codes]
      .sort()
      .map((code) => GhsPictogramCatalog.byCode.get(code))
      .filter((pictogram): pictogram is GhsPictogram => Boolean(pictogram));
  }
}

import { MixtureComponentDTO } from '@/modules/sds/sdsmixture/dto/request';

type Concentration = Pick<MixtureComponentDTO, 'percentage' | 'symbol' | 'percentageMax' | 'symbolMax'>;

/** Cómo se escribe cada símbolo en la ficha. "=" no se escribe. */
const SYMBOL_TEXT: Record<string, string> = { '>': '>', '<': '<', '>=': '≥', '<=': '≤', '=': '' };
/** Un "< x" no llega a x: para comparar con un límite se toma apenas por debajo. */
const STRICT_MARGIN = 1e-9;

const number = (value: number): string => String(value).replace('.', ',');
const bound = (symbol: string | undefined, value: number): string =>
  [SYMBOL_TEXT[symbol ?? '='], number(value)].filter(Boolean).join(' ');

/**
 * Concentración de un componente tal como la declaran las FDS (función pura): un valor con símbolo opcional
 * ("≤ 99 %") o un rango ("≥ 10 – < 20 %").
 */
export class MixtureConcentration {
  /** "≤ 99 %", "1 %", "≥ 10 – < 20 %". */
  static label(concentration: Concentration): string {
    const from = bound(concentration.symbol, concentration.percentage);
    return concentration.percentageMax === undefined
      ? `${from} %`
      : `${from} – ${bound(concentration.symbolMax, concentration.percentageMax)} %`;
  }

  /**
   * El valor para calcular peligros: el máximo posible (lo conservador). En un rango, el "hasta"; con "<",
   * apenas por debajo, para que "< 0,1 %" no alcance un límite de 0,1 %.
   */
  static upper(concentration: Concentration): number {
    const value = concentration.percentageMax ?? concentration.percentage;
    const symbol = concentration.percentageMax === undefined ? concentration.symbol : concentration.symbolMax;
    return symbol === '<' ? value - STRICT_MARGIN : value;
  }
}

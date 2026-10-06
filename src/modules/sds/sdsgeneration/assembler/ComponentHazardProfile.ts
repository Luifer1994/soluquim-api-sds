import { CurrentSourceData } from '@/modules/substance';

interface ClassificationEntry {
  hazardClasses?: unknown[];
}
interface NotifiedClassification {
  dominant?: ClassificationEntry;
}
interface IcscClassification {
  pictograms?: unknown[];
  hazardStatements?: unknown[];
}

/**
 * ¿El componente tiene clasificación de peligro? (función pura). Sirve para no llenar la ficha de una
 * mezcla con los datos de sus diluyentes inertes (agua): esos solo van en la composición.
 */
export class ComponentHazardProfile {
  /**
   * `true` solo cuando hay certeza: ECHA respondió para ese CAS y ni la clasificación armonizada, ni la
   * notificada dominante, ni la ICSC le asignan ninguna clase de peligro. Ante la duda (ECHA no lo
   * tiene o falló) el componente se trata como peligroso y sus datos se usan.
   */
  static isInert(component: CurrentSourceData): boolean {
    const value = <T>(source: string, field: string): T | undefined =>
      component.sources
        .find((s) => s.source === source && s.status === 'OK')
        ?.records.find((record) => record.field === field)?.value as T | undefined;

    const echa = component.sources.find((s) => s.source === 'ECHA' && s.status === 'OK');
    if (!echa) return false;

    const harmonised = value<ClassificationEntry[]>('ECHA', 'ghs.harmonised') ?? [];
    const notified = value<NotifiedClassification>('ECHA', 'ghs.notified');
    const icsc = value<IcscClassification>('ICSC', 'ghs.icsc');
    const classified =
      (Array.isArray(harmonised) && harmonised.some((entry) => entry.hazardClasses?.length)) ||
      Boolean(notified?.dominant?.hazardClasses?.length) ||
      Boolean(icsc?.pictograms?.length || icsc?.hazardStatements?.length);
    return !classified;
  }
}

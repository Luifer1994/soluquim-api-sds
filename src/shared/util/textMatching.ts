/** Minúsculas y sin tildes ni diacríticos: para comparar textos sin que importe cómo se escribieron. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** El texto tal cual dentro de una expresión regular (escapa sus caracteres especiales). */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

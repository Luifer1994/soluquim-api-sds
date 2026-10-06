/** No hay clave del proveedor de IA configurada: la IA está apagada (el resto del servicio funciona). */
export class AiUnavailableError extends Error {
  constructor(provider: string) {
    super(`IA no configurada: falta la clave de ${provider} en soluquim-api-sds/.env`);
    this.name = 'AiUnavailableError';
  }
}

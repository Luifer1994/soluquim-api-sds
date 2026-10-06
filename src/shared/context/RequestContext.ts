import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextData {
  requestId: string;
  tenantId?: string;
  userId?: string;
  username?: string;
  email?: string;
  permissions: string[];
  roles: string[];
  language: string;
}

const storage = new AsyncLocalStorage<RequestContextData>();

/** Tenant usado mientras la ruta del gateway no autentica y el cliente no manda X-Tenant-ID. */
export const DEFAULT_TENANT_ID = 'default';

/**
 * Contexto del request (o del mensaje de RabbitMQ) en curso. Equivale a TenantContext + UserContext
 * de soluquim-commons, pero sobre AsyncLocalStorage en vez de ThreadLocal.
 *
 * Es estático a propósito: lo usan también el logger (mixin) y el dispatcher, que no pasan por DI.
 */
export class RequestContext {
  static run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  }

  static current(): RequestContextData | undefined {
    return storage.getStore();
  }

  static get requestId(): string | undefined {
    return storage.getStore()?.requestId;
  }

  static get tenantId(): string | undefined {
    return storage.getStore()?.tenantId;
  }

  static get userId(): string | undefined {
    return storage.getStore()?.userId;
  }

  static get permissions(): string[] {
    return storage.getStore()?.permissions ?? [];
  }

  /** Tenant del request, o DEFAULT_TENANT_ID si no vino (fase sin autenticación). */
  static get tenantIdOrDefault(): string {
    return storage.getStore()?.tenantId ?? DEFAULT_TENANT_ID;
  }

  /** Tenant obligatorio: para casos de uso que solo tienen sentido dentro de una empresa. */
  static requireTenantId(): string {
    const tenantId = RequestContext.tenantId;
    if (!tenantId) throw new Error('No hay tenant en el contexto (falta X-Tenant-ID)');
    return tenantId;
  }
}

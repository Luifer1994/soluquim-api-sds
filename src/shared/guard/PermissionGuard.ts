import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSION_KEY } from '@/shared/annotation';
import { RequestContext } from '@/shared/context';

/**
 * Misma regla que `PermissionInterceptor` de soluquim-commons. El usuario pasa si tiene:
 *  - `*` (todos los permisos), o
 *  - el permiso exacto, o
 *  - el comodín del namespace (`sds:*` para `sds:documents:view`).
 */
export function hasAnyPermission(userPermissions: readonly string[], required: readonly string[]): boolean {
  if (required.length === 0) return true;
  const granted = new Set(userPermissions);
  if (granted.has('*')) return true;
  return required.some((permission) => granted.has(permission) || granted.has(`${permission.split(':')[0]}:*`));
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    if (!hasAnyPermission(RequestContext.permissions, required)) {
      throw new ForbiddenException('No tiene permisos para realizar esta acción');
    }
    return true;
  }
}

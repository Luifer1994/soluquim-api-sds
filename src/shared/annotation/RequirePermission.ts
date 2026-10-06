import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'soluquim:require-permission';

/**
 * Equivalente a `@RequirePermission` de soluquim-commons: basta con tener UNO de los permisos.
 * Se puede poner en el controller (aplica a todos sus endpoints) o en cada método.
 */
export const RequirePermission = (...permissions: string[]) => SetMetadata(REQUIRE_PERMISSION_KEY, permissions);

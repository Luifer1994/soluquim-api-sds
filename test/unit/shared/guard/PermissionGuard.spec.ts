import { hasAnyPermission } from '@/shared/guard';

describe('hasAnyPermission (misma regla que PermissionInterceptor de Java)', () => {
  it('sin permisos requeridos siempre pasa', () => {
    expect(hasAnyPermission([], [])).toBe(true);
  });

  it('acepta el permiso exacto', () => {
    expect(hasAnyPermission(['sds:documents:view'], ['sds:documents:view'])).toBe(true);
  });

  it('basta con uno de los requeridos', () => {
    expect(hasAnyPermission(['sds:documents:edit'], ['sds:documents:view', 'sds:documents:edit'])).toBe(true);
  });

  it('acepta el comodín global *', () => {
    expect(hasAnyPermission(['*'], ['sds:documents:approve'])).toBe(true);
  });

  it('acepta el comodín del namespace', () => {
    expect(hasAnyPermission(['sds:*'], ['sds:documents:approve'])).toBe(true);
  });

  it('rechaza si no tiene ninguno', () => {
    expect(hasAnyPermission(['products:view'], ['sds:documents:view'])).toBe(false);
  });

  it('rechaza un usuario sin permisos', () => {
    expect(hasAnyPermission([], ['sds:documents:view'])).toBe(false);
  });
});

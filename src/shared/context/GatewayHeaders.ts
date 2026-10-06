/** Headers que el API Gateway propaga a los microservicios tras validar el JWT. */
export const GatewayHeaders = {
  REQUEST_ID: 'x-request-id',
  TENANT_ID: 'x-tenant-id',
  USER_ID: 'x-user-id',
  USERNAME: 'x-username',
  USER_PERMISSIONS: 'x-user-permissions',
  USER_ROLES: 'x-user-roles',
  ACCEPT_LANGUAGE: 'accept-language',
} as const;

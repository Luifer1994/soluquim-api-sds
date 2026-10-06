import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { GatewayHeaders } from '@/shared/context/GatewayHeaders';
import { RequestContext } from '@/shared/context/RequestContext';

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Lee los headers que inyecta el gateway y deja el contexto disponible para todo el request.
 * El JWT NO se valida aquí: ya lo validó el gateway y este servicio no se expone fuera de la red Docker.
 */
@Injectable()
export class GatewayContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = header(req, GatewayHeaders.REQUEST_ID) ?? randomUUID();
    req.headers[GatewayHeaders.REQUEST_ID] = requestId;
    res.setHeader('X-Request-ID', requestId);

    RequestContext.run(
      {
        requestId,
        tenantId: header(req, GatewayHeaders.TENANT_ID),
        userId: header(req, GatewayHeaders.USER_ID),
        username: header(req, GatewayHeaders.USERNAME),
        permissions: csv(header(req, GatewayHeaders.USER_PERMISSIONS)),
        roles: csv(header(req, GatewayHeaders.USER_ROLES)),
        language: header(req, GatewayHeaders.ACCEPT_LANGUAGE)?.slice(0, 2) ?? 'es',
      },
      () => next(),
    );
  }
}

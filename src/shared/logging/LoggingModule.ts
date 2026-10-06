import { randomUUID } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from '@/shared/config';
import { GatewayHeaders, RequestContext } from '@/shared/context';

/**
 * Logs JSON (pino). Cada línea lleva requestId/tenantId/userId del contexto actual, tanto en HTTP
 * como en el worker (el dispatcher restaura el contexto del mensaje).
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.log.level,
          base: { service: 'soluquim-api-sds' },
          transport: config.log.pretty ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          mixin: () => {
            const ctx = RequestContext.current();
            return ctx ? { requestId: ctx.requestId, tenantId: ctx.tenantId, userId: ctx.userId } : {};
          },
          genReqId: (req: IncomingMessage) => {
            const existing = req.headers[GatewayHeaders.REQUEST_ID];
            const id = (Array.isArray(existing) ? existing[0] : existing) || randomUUID();
            req.headers[GatewayHeaders.REQUEST_ID] = id;
            return id;
          },
          autoLogging: { ignore: (req: IncomingMessage) => req.url?.includes('/v1/health') ?? false },
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
        },
      }),
    }),
  ],
})
export class LoggingModule {}

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { IndexController } from '@/controller';
import { AiModule } from '@/shared/ai';
import { AppConfigModule } from '@/shared/config';
import { GatewayContextMiddleware } from '@/shared/context';
import { HttpExceptionFilter } from '@/shared/exception';
import { KnowledgeModule } from '@/modules/knowledge';
import { ReferenceModule } from '@/modules/reference';
import { SdsModule } from '@/modules/sds';
import { SubstanceModule } from '@/modules/substance';
import { PermissionGuard } from '@/shared/guard';
import { HealthModule } from '@/shared/health';
import { HttpModule, ResultInterceptor } from '@/shared/http';
import { LoggingModule } from '@/shared/logging';
import { MessagingModule } from '@/shared/messaging';
import { PersistenceModule } from '@/shared/persistence';
import { SeedModule } from '@/shared/seed';

/**
 * Módulo raíz. Lo usan los dos procesos (API y worker) con el mismo código; cambia solo el punto de
 * entrada. Los módulos de negocio (`modules/…`) se registran aquí a medida que se implementan.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    PersistenceModule,
    MessagingModule,
    HttpModule,
    AiModule,
    SeedModule,
    HealthModule,
    // Módulos de negocio
    SubstanceModule,
    KnowledgeModule,
    ReferenceModule,
    SdsModule,
  ],
  controllers: [IndexController],
  providers: [
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: ResultInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(GatewayContextMiddleware).forRoutes('*path');
  }
}

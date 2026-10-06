import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from '@/AppModule';
import { AsyncTaskDispatcher } from '@/shared/messaging';

/** Proceso worker: sin servidor HTTP. Consume `soluquim.sds.tasks.q` y ejecuta el trabajo pesado. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  await app.get(AsyncTaskDispatcher).start();
  app.get(Logger).log('soluquim-api-sds worker iniciado', 'Bootstrap');
}

void bootstrap();

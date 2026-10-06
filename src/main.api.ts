import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from '@/AppModule';
import { AppConfig } from '@/shared/config';

/** Proceso HTTP: recibe requests vía gateway y PUBLICA tareas. Nunca consume la cola. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfig);
  // `/` queda fuera del prefijo: es la respuesta básica "is running" (IndexController), como en los micros Java.
  app.setGlobalPrefix('api/sds', { exclude: [{ path: '/', method: RequestMethod.GET }] });
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.useBodyParser('json', { limit: '1mb' });
  app.enableShutdownHooks();

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Soluquim — SDS API')
        .setDescription('Generación de Fichas de Datos de Seguridad (FDS)')
        .setVersion('1.0')
        .build(),
    );
    // Mismo path que los micros Java: el gateway lo agrega en /v3/api-docs/sds.
    SwaggerModule.setup('api/sds/docs', app, document, { jsonDocumentUrl: 'v3/api-docs' });
  }

  await app.listen(config.port, '0.0.0.0');
  app.get(Logger).log(`soluquim-api-sds escuchando en :${config.port}`, 'Bootstrap');
}

void bootstrap();

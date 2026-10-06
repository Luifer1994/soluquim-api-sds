import { Global, Module } from '@nestjs/common';
import { AppConfig } from '@/shared/config/AppConfig';
import { parseEnv } from '@/shared/config/env.schema';

@Global()
@Module({
  providers: [{ provide: AppConfig, useFactory: () => new AppConfig(parseEnv(process.env)) }],
  exports: [AppConfig],
})
export class AppConfigModule {}

import { Global, Module } from '@nestjs/common';
import { ExternalHttpClient } from '@/shared/http/ExternalHttpClient';

@Global()
@Module({
  providers: [ExternalHttpClient],
  exports: [ExternalHttpClient],
})
export class HttpModule {}

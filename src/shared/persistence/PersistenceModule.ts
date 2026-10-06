import { Global, Module } from '@nestjs/common';
import { PrismaService } from '@/shared/persistence/PrismaService';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PersistenceModule {}

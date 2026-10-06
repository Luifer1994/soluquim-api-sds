import { Module } from '@nestjs/common';
import { HealthController } from '@/shared/health/HealthController';
import { PingTaskHandler } from '@/shared/health/PingTaskHandler';

@Module({
  controllers: [HealthController],
  providers: [PingTaskHandler],
})
export class HealthModule {}

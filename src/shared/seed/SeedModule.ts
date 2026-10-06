import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { SeederRunner } from '@/shared/seed/SeederRunner';

@Module({
  imports: [DiscoveryModule],
  providers: [SeederRunner],
})
export class SeedModule {}

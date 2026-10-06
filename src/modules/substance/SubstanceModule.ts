import { Module } from '@nestjs/common';
import { SourceModule } from '@/modules/source';
import { SubstanceController } from '@/modules/substance/substance/controller';
import { SubstanceRepository } from '@/modules/substance/substance/repository';
import { GetSubstanceByCasService } from '@/modules/substance/substance/service';
import {
  RawSnapshotRepository,
  SubstanceSourceDataRepository,
} from '@/modules/substance/substancesourcedata/repository';
import { SourceFetchScheduler, SourceFetchTaskHandler } from '@/modules/substance/substancesourcedata/messaging';
import {
  CollectSubstanceDataService,
  ListCurrentSourceDataService,
} from '@/modules/substance/substancesourcedata/service';

@Module({
  imports: [SourceModule],
  controllers: [SubstanceController],
  providers: [
    SubstanceRepository,
    SubstanceSourceDataRepository,
    RawSnapshotRepository,
    CollectSubstanceDataService,
    GetSubstanceByCasService,
    SourceFetchScheduler,
    SourceFetchTaskHandler,
    ListCurrentSourceDataService,
  ],
  exports: [GetSubstanceByCasService, CollectSubstanceDataService, ListCurrentSourceDataService],
})
export class SubstanceModule {}

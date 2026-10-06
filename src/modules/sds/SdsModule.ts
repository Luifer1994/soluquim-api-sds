import { Module } from '@nestjs/common';
import { KnowledgeModule } from '@/modules/knowledge';
import { SubstanceModule } from '@/modules/substance';
import { SdsDocumentController } from '@/modules/sds/sdsdocument/controller';
import { SdsDocumentRepository } from '@/modules/sds/sdsdocument/repository';
import {
  CreateSdsDocumentDraftService,
  GetSdsDocumentByIdService,
  ListSdsDocumentsService,
  UpdateSdsDocumentFieldService,
} from '@/modules/sds/sdsdocument/service';
import { SdsSectionDraftingAgent } from '@/modules/sds/sdsgeneration/agent';
import { SdsGenerationController } from '@/modules/sds/sdsgeneration/controller';
import { SdsGenerationRequestedHandler } from '@/modules/sds/sdsgeneration/messaging';
import { SdsGenerationJobRepository } from '@/modules/sds/sdsgeneration/repository';
import {
  GetSdsGenerationJobService,
  RequestSdsGenerationService,
  RunSdsGenerationService,
} from '@/modules/sds/sdsgeneration/service';
import { SdsMixtureController } from '@/modules/sds/sdsmixture/controller';
import { LookupMixtureService } from '@/modules/sds/sdsmixture/service';

@Module({
  imports: [SubstanceModule, KnowledgeModule],
  controllers: [SdsMixtureController, SdsGenerationController, SdsDocumentController],
  providers: [
    // sdsmixture
    LookupMixtureService,
    // sdsgeneration
    SdsGenerationJobRepository,
    SdsSectionDraftingAgent,
    RequestSdsGenerationService,
    RunSdsGenerationService,
    GetSdsGenerationJobService,
    SdsGenerationRequestedHandler,
    // sdsdocument
    SdsDocumentRepository,
    CreateSdsDocumentDraftService,
    GetSdsDocumentByIdService,
    ListSdsDocumentsService,
    UpdateSdsDocumentFieldService,
  ],
})
export class SdsModule {}

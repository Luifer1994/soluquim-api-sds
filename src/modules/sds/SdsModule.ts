import { Module } from '@nestjs/common';
import { KnowledgeModule } from '@/modules/knowledge';
import { ReferenceModule } from '@/modules/reference';
import { SubstanceModule } from '@/modules/substance';
import { SdsDocumentController } from '@/modules/sds/sdsdocument/controller';
import { SdsDocumentRepository } from '@/modules/sds/sdsdocument/repository';
import {
  CreateSdsDocumentDraftService,
  GetSdsDocumentByIdService,
  ListSdsDocumentsService,
  UpdateSdsDocumentFieldService,
} from '@/modules/sds/sdsdocument/service';
import {
  SdsGapFillingAgent,
  SdsQualityReviewAgent,
  SdsSectionDraftingAgent,
  SdsSpecialistDraftingAgents,
  SdsSpecialistReviewAgent,
} from '@/modules/sds/sdsgeneration/agent';
import { SdsGenerationController } from '@/modules/sds/sdsgeneration/controller';
import { SdsSourceSearchToolkit } from '@/modules/sds/sdsgeneration/tool';
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
  imports: [SubstanceModule, KnowledgeModule, ReferenceModule],
  controllers: [SdsMixtureController, SdsGenerationController, SdsDocumentController],
  providers: [
    // sdsmixture
    LookupMixtureService,
    // sdsgeneration
    SdsGenerationJobRepository,
    SdsSectionDraftingAgent,
    SdsSpecialistDraftingAgents,
    SdsGapFillingAgent,
    SdsSourceSearchToolkit,
    SdsSpecialistReviewAgent,
    SdsQualityReviewAgent,
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

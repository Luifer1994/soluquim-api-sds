import { Module } from '@nestjs/common';
import { SubstanceModule } from '@/modules/substance';
import { KnowledgeController } from '@/modules/knowledge/controller';
import { KnowledgeIndexTaskHandler } from '@/modules/knowledge/messaging';
import { KnowledgeChunkRepository } from '@/modules/knowledge/repository';
import {
  BuildSectionContextService,
  IndexSubstanceKnowledgeService,
  SearchKnowledgeService,
  SyncSubstanceKnowledgeService,
} from '@/modules/knowledge/service';
import { SearchKnowledgeTool } from '@/modules/knowledge/tool';

/** Base de conocimiento del agente: fragmentos vectorizados (pgvector) de los datos de las fuentes. */
@Module({
  imports: [SubstanceModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeChunkRepository,
    BuildSectionContextService,
    IndexSubstanceKnowledgeService,
    SearchKnowledgeService,
    SyncSubstanceKnowledgeService,
    KnowledgeIndexTaskHandler,
    SearchKnowledgeTool,
  ],
  exports: [
    BuildSectionContextService,
    IndexSubstanceKnowledgeService,
    SearchKnowledgeService,
    SyncSubstanceKnowledgeService,
    SearchKnowledgeTool,
  ],
})
export class KnowledgeModule {}

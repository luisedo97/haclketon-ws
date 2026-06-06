import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService, OllamaService } from './ai.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { HeuristicsService } from './heuristics.service';
import { ProposalWorkerService } from './proposal-worker.service';
import { ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';

@Module({
  imports: [ConversationsModule],
  controllers: [AiController, ProposalsController],
  providers: [
    OllamaService,
    AiService,
    HeuristicsService,
    ProposalsService,
    ProposalWorkerService,
  ],
  exports: [
    OllamaService,
    AiService,
    HeuristicsService,
    ProposalsService,
  ],
})
export class AiModule {}

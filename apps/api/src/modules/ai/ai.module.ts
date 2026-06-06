import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService, OllamaService } from './ai.service';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [ConversationsModule],
  controllers: [AiController],
  providers: [OllamaService, AiService],
  exports: [OllamaService, AiService],
})
export class AiModule {}

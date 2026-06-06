import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { MonitoredGroupsModule } from '../monitored-groups/monitored-groups.module';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [AiModule, MonitoredGroupsModule],
  controllers: [WhatsappController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}

import { Body, Controller, Post } from '@nestjs/common';
import { AnalyzeConversationDto } from '../../common/dto';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('analyze')
  analyzeConversation(@Body() dto: AnalyzeConversationDto) {
    return this.aiService.analyzeConversation(dto);
  }
}

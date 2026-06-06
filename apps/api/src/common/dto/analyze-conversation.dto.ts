import { IsString, MinLength } from 'class-validator';

export class AnalyzeConversationDto {
  @IsString()
  @MinLength(1)
  conversationId!: string;

  @IsString()
  @MinLength(1)
  fromMessageId!: string;

  @IsString()
  @MinLength(1)
  toMessageId!: string;
}

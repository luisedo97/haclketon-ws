import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiAnalysisOutputSchema,
  AnalyzeResponseDto,
  formatConversationTitle,
} from '@ws-spy/shared';
import { AnalyzeConversationDto } from '../../common/dto';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';

interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

interface MessageRecord {
  id: string;
  fromMe: boolean;
  text: string | null;
  sentAt: Date;
}

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl =
      this.configService.get<string>('OLLAMA_BASE_URL') ??
      'http://localhost:11434';
    this.model =
      this.configService.get<string>('OLLAMA_MODEL') ?? 'gemma3:1b';
  }

  getModel(): string {
    return this.model;
  }

  async generate(prompt: string): Promise<string> {
    const url = `${this.baseUrl}/api/generate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        format: 'json',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(`Ollama error: ${response.status} ${body}`);
      throw new Error(`Ollama request failed: ${response.status}`);
    }

    const data = (await response.json()) as OllamaGenerateResponse;
    return data.response;
  }
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly ollamaService: OllamaService,
    private readonly prisma: PrismaService,
    private readonly conversationsService: ConversationsService,
  ) {}

  async analyzeConversation(
    dto: AnalyzeConversationDto,
  ): Promise<AnalyzeResponseDto> {
    const { conversation, fromMessage, toMessage, messages } =
      await this.conversationsService.getMessagesInRange(
        dto.conversationId,
        dto.fromMessageId,
        dto.toMessageId,
      );

    if (messages.length === 0) {
      throw new BadRequestException('No hay mensajes en el rango seleccionado');
    }

    const analyzableMessages = messages.filter(
      (message) => message.text && message.text.trim().length > 0,
    );

    if (analyzableMessages.length === 0) {
      throw new BadRequestException(
        'El rango seleccionado no contiene mensajes de texto analizables',
      );
    }

    const contactName = formatConversationTitle(
      conversation.jid,
      conversation.contact,
      conversation.title,
    );
    const assigneeName = conversation.contact?.displayName ?? contactName;
    const prompt = this.buildPrompt(
      assigneeName,
      analyzableMessages,
      fromMessage.sentAt,
      toMessage.sentAt,
    );

    const rawResponse = await this.ollamaService.generate(prompt);
    const parsed = this.parseAnalysisResponse(rawResponse);
    const model = this.ollamaService.getModel();

    const saved = await this.prisma.aiAnalysis.create({
      data: {
        scope: 'conversation-range',
        refId: conversation.id,
        model,
        output: {
          ...parsed,
          range: {
            fromMessageId: fromMessage.id,
            toMessageId: toMessage.id,
            fromAt: fromMessage.sentAt.toISOString(),
            toAt: toMessage.sentAt.toISOString(),
          },
          messageCount: analyzableMessages.length,
          contactName: assigneeName,
        },
      },
    });

    return {
      id: saved.id,
      hasTasks: parsed.hasTasks,
      summary: parsed.summary,
      tasks: parsed.tasks,
      model,
      messageCount: analyzableMessages.length,
      contactName: assigneeName,
      range: {
        fromMessageId: fromMessage.id,
        toMessageId: toMessage.id,
        fromAt: fromMessage.sentAt.toISOString(),
        toAt: toMessage.sentAt.toISOString(),
      },
    };
  }

  private buildPrompt(
    assigneeName: string,
    messages: MessageRecord[],
    fromAt: Date,
    toAt: Date,
  ): string {
    const transcript = messages
      .map((message) => {
        const author = message.fromMe ? 'Yo' : assigneeName;
        const time = message.sentAt.toISOString().slice(11, 16);
        return `[${time}] ${author}: ${message.text?.trim()}`;
      })
      .join('\n');

    return `Analiza el siguiente fragmento de conversación de WhatsApp e identifica tareas pendientes para "${assigneeName}".

IMPORTANTE:
- Solo extrae tareas que "${assigneeName}" debe hacer según lo hablado.
- No inventes tareas que no estén respaldadas por el texto.
- Si no hay tareas claras, responde hasTasks=false y tasks=[].
- Responde SOLO con JSON válido, sin markdown.

Rango analizado: ${fromAt.toISOString()} → ${toAt.toISOString()}

Conversación:
${transcript}

Formato JSON requerido:
{
  "hasTasks": boolean,
  "summary": "Resumen breve del fragmento (1-2 oraciones)",
  "tasks": [
    {
      "title": "Acción concreta",
      "description": "Qué debe hacer y contexto breve",
      "priority": "low" | "medium" | "high",
      "dueHint": "Plazo mencionado o null"
    }
  ]
}`;
  }

  private parseAnalysisResponse(raw: string) {
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      this.logger.warn(`Invalid JSON from Ollama: ${raw}`);
      throw new BadRequestException(
        'La IA no devolvió un formato válido. Intenta con un rango más corto.',
      );
    }

    parsed = this.normalizeAnalysisOutput(parsed);

    const result = AiAnalysisOutputSchema.safeParse(parsed);
    if (!result.success) {
      this.logger.warn(`Schema validation failed: ${result.error.message}`);
      throw new BadRequestException(
        'La IA devolvió un formato incompleto. Intenta nuevamente.',
      );
    }

    if (!result.data.hasTasks) {
      return {
        ...result.data,
        tasks: [],
      };
    }

    return result.data;
  }

  private normalizeAnalysisOutput(parsed: unknown): unknown {
    if (!parsed || typeof parsed !== 'object') {
      return parsed;
    }

    const data = parsed as Record<string, unknown>;

    if (!Array.isArray(data.tasks)) {
      return data;
    }

    return {
      ...data,
      tasks: data.tasks.map((task) => {
        if (!task || typeof task !== 'object') {
          return task;
        }

        const item = task as Record<string, unknown>;
        return {
          ...item,
          dueHint: item.dueHint ?? null,
          description:
            typeof item.description === 'string' ? item.description : '',
          priority:
            item.priority === 'low' ||
            item.priority === 'medium' ||
            item.priority === 'high'
              ? item.priority
              : 'medium',
        };
      }),
    };
  }
}

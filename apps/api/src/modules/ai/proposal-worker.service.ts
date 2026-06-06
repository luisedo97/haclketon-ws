import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  QueueStatus as PrismaQueueStatus,
} from '@prisma/client';
import {
  ProposalLlmOutputSchema,
  formatConversationTitle,
} from '@ws-spy/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { OllamaService } from './ai.service';
import {
  PromptMessage,
  buildProposalPrompt,
} from './prompts/proposal.prompt';
import { ProposalsService } from './proposals.service';

const MAX_ATTEMPTS = 3;
const FLUSH_EVERY = 50;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface WorkerCounters {
  processed: number;
  proposalsCreated: number;
  totalLatencyMs: number;
  errors: number;
  invalidJson: number;
}

@Injectable()
export class ProposalWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProposalWorkerService.name);
  private interval?: ReturnType<typeof setInterval>;
  private isRunning = false;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly contextWindow: number;

  private counters: WorkerCounters = {
    processed: 0,
    proposalsCreated: 0,
    totalLatencyMs: 0,
    errors: 0,
    invalidJson: 0,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly ollamaService: OllamaService,
    private readonly proposalsService: ProposalsService,
    private readonly eventsGateway: EventsGateway,
    private readonly configService: ConfigService,
  ) {
    this.intervalMs = Number(
      this.configService.get<string>('AI_WORKER_INTERVAL_MS') ?? 5000,
    );
    this.batchSize = Number(
      this.configService.get<string>('AI_WORKER_BATCH_SIZE') ?? 5,
    );
    this.contextWindow = Number(
      this.configService.get<string>('AI_CONTEXT_WINDOW') ?? 15,
    );
  }

  onModuleInit() {
    this.logger.log(
      `ProposalWorker iniciado (intervalo=${this.intervalMs}ms, batch=${this.batchSize}, contexto=${this.contextWindow})`,
    );
    this.interval = setInterval(() => void this.tick(), this.intervalMs);
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private async tick() {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    try {
      const claimed = await this.claimBatch();
      for (const item of claimed) {
        await this.processItem(item.id);
      }
    } catch (error) {
      this.logger.error(
        `Worker tick error: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async claimBatch(): Promise<Array<{ id: string }>> {
    return this.prisma.$transaction(async (tx) => {
      const pending = await tx.analysisQueue.findMany({
        where: { status: PrismaQueueStatus.PENDING },
        orderBy: { enqueuedAt: 'asc' },
        take: this.batchSize,
        select: { id: true },
      });
      if (pending.length === 0) {
        return [];
      }
      await tx.analysisQueue.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: { status: PrismaQueueStatus.PROCESSING },
      });
      return pending;
    });
  }

  private async processItem(queueId: string) {
    const startedAt = Date.now();
    const item = await this.prisma.analysisQueue.findUnique({
      where: { id: queueId },
      include: {
        message: {
          include: {
            conversation: {
              include: {
                contact: true,
              },
            },
          },
        },
      },
    });

    if (!item || !item.message) {
      await this.markDone(queueId);
      return;
    }

    const text = item.message.text?.trim();
    if (!text) {
      await this.markSkipped(queueId, 'empty_text');
      return;
    }

    const existing = await this.proposalsService.findByMessageId(
      item.messageId,
    );
    if (existing) {
      await this.markDone(queueId);
      return;
    }

    try {
      const context = await this.loadContext(
        item.message.conversationId,
        item.message.id,
      );
      const conversationTitle = formatConversationTitle(
        item.message.conversation.jid,
        item.message.conversation.contact,
        item.message.conversation.title,
      );
      const todayIso = new Date().toISOString().slice(0, 10);

      const prompt = buildProposalPrompt({
        messages: context.messages,
        focusIndex: context.focusIndex,
        conversationTitle,
        todayIso,
      });

      const raw = await this.ollamaService.generate(prompt);
      const parsed = this.parseLlmResponse(raw);

      if (!parsed) {
        this.counters.invalidJson += 1;
        await this.handleFailure(queueId, item.attempts, 'invalid_json');
        return;
      }

      if (parsed.es_tarea && parsed.titulo.trim().length > 0) {
        const fechaLimite = parseFechaLimite(parsed.fecha_limite);
        const proposal = await this.proposalsService.create({
          sourceMessageId: item.messageId,
          conversationId: item.message.conversationId,
          titulo: parsed.titulo.trim(),
          descripcion: parsed.descripcion?.trim() || null,
          fechaLimite,
          categoria: parsed.categoria,
          responsableProbable: parsed.responsable_probable,
          confianza: parsed.confianza,
          modelUsed: this.ollamaService.getModel(),
          rawOutput: parsed as unknown as object,
        });
        this.counters.proposalsCreated += 1;
        this.eventsGateway.emitProposalCreated({
          proposalId: proposal.id,
          conversationId: proposal.conversationId,
          categoria: proposal.categoria,
          confianza: proposal.confianza,
        });
      }

      await this.markDone(queueId);
    } catch (error) {
      this.counters.errors += 1;
      this.logger.warn(
        `Falló item ${queueId}: ${error instanceof Error ? error.message : error}`,
      );
      await this.handleFailure(
        queueId,
        item.attempts,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.counters.processed += 1;
      this.counters.totalLatencyMs += Date.now() - startedAt;
      this.maybeFlushMetrics();
    }
  }

  private async loadContext(
    conversationId: string,
    focusMessageId: string,
  ): Promise<{ messages: PromptMessage[]; focusIndex: number }> {
    const focus = await this.prisma.message.findUnique({
      where: { id: focusMessageId },
    });
    if (!focus) {
      throw new Error(`focus message ${focusMessageId} not found`);
    }

    const previous = await this.prisma.message.findMany({
      where: {
        conversationId,
        sentAt: { lt: focus.sentAt },
        text: { not: null },
      },
      orderBy: { sentAt: 'desc' },
      take: Math.max(this.contextWindow - 1, 0),
    });

    const ordered = [...previous.reverse(), focus].filter(
      (m) => m.text && m.text.trim().length > 0,
    );

    const messages: PromptMessage[] = ordered.map((m) => ({
      text: m.text as string,
      fromMe: m.fromMe,
      sentAt: m.sentAt,
      authorLabel: m.fromMe ? 'Yo' : 'Otro',
    }));

    const focusIndex = ordered.findIndex((m) => m.id === focusMessageId);
    return {
      messages,
      focusIndex: focusIndex >= 0 ? focusIndex : messages.length - 1,
    };
  }

  private parseLlmResponse(raw: string) {
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
      this.logger.warn(`LLM devolvió JSON inválido: ${raw.slice(0, 200)}`);
      return null;
    }

    const result = ProposalLlmOutputSchema.safeParse(parsed);
    if (!result.success) {
      this.logger.warn(
        `Schema validation falló: ${result.error.message} | raw=${raw.slice(0, 200)}`,
      );
      return null;
    }
    return result.data;
  }

  private async handleFailure(
    queueId: string,
    previousAttempts: number,
    reason: string,
  ) {
    const attempts = previousAttempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await this.prisma.analysisQueue.update({
        where: { id: queueId },
        data: {
          status: PrismaQueueStatus.ERROR,
          attempts,
          lastError: reason,
          processedAt: new Date(),
        },
      });
    } else {
      await this.prisma.analysisQueue.update({
        where: { id: queueId },
        data: {
          status: PrismaQueueStatus.PENDING,
          attempts,
          lastError: reason,
        },
      });
    }
  }

  private async markDone(queueId: string) {
    await this.prisma.analysisQueue.update({
      where: { id: queueId },
      data: {
        status: PrismaQueueStatus.DONE,
        processedAt: new Date(),
      },
    });
  }

  private async markSkipped(queueId: string, reason: string) {
    await this.prisma.analysisQueue.update({
      where: { id: queueId },
      data: {
        status: PrismaQueueStatus.SKIPPED,
        lastError: reason,
        processedAt: new Date(),
      },
    });
  }

  private maybeFlushMetrics() {
    if (
      this.counters.processed === 0 ||
      this.counters.processed % FLUSH_EVERY !== 0
    ) {
      return;
    }
    const c = this.counters;
    const avgMs = (c.totalLatencyMs / c.processed).toFixed(0);
    const propPct = ((c.proposalsCreated / c.processed) * 100).toFixed(1);
    this.logger.log(
      `[metrics] worker_processed=${c.processed} proposals=${c.proposalsCreated} (${propPct}%) ` +
        `errors=${c.errors} invalid_json=${c.invalidJson} avg_latency=${avgMs}ms`,
    );
  }
}

function parseFechaLimite(raw: string | null): Date | null {
  if (!raw) {
    return null;
  }
  if (!ISO_DATE_RE.test(raw)) {
    return null;
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

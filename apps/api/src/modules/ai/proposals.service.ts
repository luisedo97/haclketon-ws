import { Injectable, NotFoundException } from '@nestjs/common';
import { ProposalStatus as PrismaProposalStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateProposalInput {
  sourceMessageId: string;
  conversationId: string;
  titulo: string;
  descripcion: string | null;
  fechaLimite: Date | null;
  categoria: string;
  responsableProbable: string | null;
  confianza: number;
  modelUsed: string;
  rawOutput: Prisma.InputJsonValue;
  status?: PrismaProposalStatus;
}

@Injectable()
export class ProposalsService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateProposalInput) {
    return this.prisma.taskProposal.create({
      data: {
        sourceMessageId: input.sourceMessageId,
        conversationId: input.conversationId,
        titulo: input.titulo.slice(0, 500),
        descripcion: input.descripcion,
        fechaLimite: input.fechaLimite,
        categoria: input.categoria.slice(0, 50),
        responsableProbable: input.responsableProbable?.slice(0, 200) ?? null,
        confianza: input.confianza,
        modelUsed: input.modelUsed.slice(0, 100),
        rawOutput: input.rawOutput,
        status: input.status ?? PrismaProposalStatus.PENDIENTE,
      },
    });
  }

  findByMessageId(messageId: string) {
    return this.prisma.taskProposal.findUnique({
      where: { sourceMessageId: messageId },
    });
  }

  list(params: { status?: PrismaProposalStatus; limit?: number }) {
    const take = Math.min(Math.max(params.limit ?? 50, 1), 200);
    return this.prisma.taskProposal.findMany({
      where: params.status ? { status: params.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        conversation: {
          select: { id: true, jid: true, title: true },
        },
      },
    });
  }

  async getDetail(id: string) {
    const proposal = await this.prisma.taskProposal.findUnique({
      where: { id },
      include: {
        sourceMessage: true,
        conversation: {
          select: { id: true, jid: true, title: true },
        },
      },
    });
    if (!proposal) {
      throw new NotFoundException(`Proposal ${id} not found`);
    }
    return proposal;
  }
}

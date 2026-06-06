import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ProposalStatus as PrismaProposalStatus,
  TaskStatus as PrismaTaskStatus,
} from '@prisma/client';
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
  creatorUserId?: string | null;
  matchedAssigneeUserId?: string | null;
}

export interface UpdateProposalDraftInput {
  titulo?: string;
  descripcion?: string | null;
  fechaLimite?: Date | null;
  categoria?: string;
  assigneeUserId?: string | null;
}

export interface ApproveProposalInput extends UpdateProposalDraftInput {}

const PROPOSAL_INCLUDE = {
  sourceMessage: true,
  conversation: { select: { id: true, jid: true, title: true } },
  creator: { select: { id: true, displayName: true, role: true } },
  matchedAssignee: {
    select: { id: true, displayName: true, role: true, phoneE164: true },
  },
  resultingTask: { select: { id: true, status: true } },
} satisfies Prisma.TaskProposalInclude;

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
        creatorUserId: input.creatorUserId ?? null,
        matchedAssigneeUserId: input.matchedAssigneeUserId ?? null,
      },
    });
  }

  findByMessageId(messageId: string) {
    return this.prisma.taskProposal.findUnique({
      where: { sourceMessageId: messageId },
    });
  }

  listForUser(params: {
    userId: string;
    status?: PrismaProposalStatus;
    limit?: number;
  }) {
    const take = Math.min(Math.max(params.limit ?? 50, 1), 200);
    return this.prisma.taskProposal.findMany({
      where: {
        creatorUserId: params.userId,
        ...(params.status ? { status: params.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: PROPOSAL_INCLUDE,
    });
  }

  countPendingForUser(userId: string) {
    return this.prisma.taskProposal.count({
      where: { creatorUserId: userId, status: PrismaProposalStatus.PENDIENTE },
    });
  }

  async getForUser(id: string, userId: string) {
    const proposal = await this.prisma.taskProposal.findFirst({
      where: { id, creatorUserId: userId },
      include: PROPOSAL_INCLUDE,
    });
    if (!proposal) {
      throw new NotFoundException(`Proposal ${id} not found`);
    }
    return proposal;
  }

  async updateDraft(id: string, userId: string, patch: UpdateProposalDraftInput) {
    await this.assertOwnedPendingPropose(id, userId);

    return this.prisma.taskProposal.update({
      where: { id },
      data: {
        ...(patch.titulo !== undefined
          ? { titulo: patch.titulo.slice(0, 500) }
          : {}),
        ...(patch.descripcion !== undefined
          ? { descripcion: patch.descripcion }
          : {}),
        ...(patch.fechaLimite !== undefined
          ? { fechaLimite: patch.fechaLimite }
          : {}),
        ...(patch.categoria !== undefined
          ? { categoria: patch.categoria.slice(0, 50) }
          : {}),
        ...(patch.assigneeUserId !== undefined
          ? { matchedAssigneeUserId: patch.assigneeUserId }
          : {}),
      },
      include: PROPOSAL_INCLUDE,
    });
  }

  async approve(id: string, userId: string, patch: ApproveProposalInput) {
    const proposal = await this.assertOwnedPendingPropose(id, userId);

    const finalTitulo = (patch.titulo ?? proposal.titulo).slice(0, 500);
    const finalDescripcion =
      patch.descripcion !== undefined ? patch.descripcion : proposal.descripcion;
    const finalFecha =
      patch.fechaLimite !== undefined ? patch.fechaLimite : proposal.fechaLimite;
    const finalCategoria = (patch.categoria ?? proposal.categoria).slice(0, 50);
    const finalAssigneeUserId =
      patch.assigneeUserId !== undefined
        ? patch.assigneeUserId
        : proposal.matchedAssigneeUserId;

    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          title: finalTitulo,
          description: finalDescripcion,
          category: finalCategoria,
          dueAt: finalFecha,
          status: PrismaTaskStatus.PENDING,
          assigneeUserId: finalAssigneeUserId,
          createdByUserId: userId,
          sourceProposalId: proposal.id,
        },
      });

      const updated = await tx.taskProposal.update({
        where: { id: proposal.id },
        data: {
          status: PrismaProposalStatus.APROBADA,
          titulo: finalTitulo,
          descripcion: finalDescripcion,
          fechaLimite: finalFecha,
          categoria: finalCategoria,
          matchedAssigneeUserId: finalAssigneeUserId,
        },
        include: PROPOSAL_INCLUDE,
      });

      return { proposal: updated, task };
    });
  }

  async discard(id: string, userId: string) {
    await this.assertOwnedPendingPropose(id, userId);
    return this.prisma.taskProposal.update({
      where: { id },
      data: { status: PrismaProposalStatus.DESCARTADA },
      include: PROPOSAL_INCLUDE,
    });
  }

  /**
   * Cuando un usuario vincula su número, re-atribuye las proposals RETENIDAS
   * cuyo mensaje fuente sea de ese número.
   */
  async attachOrphans(userId: string, phoneE164: string) {
    const orphans = await this.prisma.taskProposal.findMany({
      where: {
        status: PrismaProposalStatus.RETENIDA,
        creatorUserId: null,
        sourceMessage: {
          senderJid: { contains: phoneE164 },
        },
      },
      select: { id: true },
    });
    if (orphans.length === 0) return [];

    await this.prisma.taskProposal.updateMany({
      where: { id: { in: orphans.map((o) => o.id) } },
      data: {
        creatorUserId: userId,
        status: PrismaProposalStatus.PENDIENTE,
      },
    });

    return this.prisma.taskProposal.findMany({
      where: { id: { in: orphans.map((o) => o.id) } },
      include: PROPOSAL_INCLUDE,
    });
  }

  private async assertOwnedPendingPropose(id: string, userId: string) {
    const proposal = await this.prisma.taskProposal.findFirst({
      where: { id, creatorUserId: userId },
    });
    if (!proposal) {
      throw new NotFoundException(`Proposal ${id} not found`);
    }
    if (proposal.status !== PrismaProposalStatus.PENDIENTE) {
      throw new NotFoundException(
        `La propuesta ya no está pendiente (estado actual: ${proposal.status})`,
      );
    }
    return proposal;
  }
}

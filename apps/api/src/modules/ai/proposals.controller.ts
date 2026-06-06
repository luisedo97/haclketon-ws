import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ProposalStatus as PrismaProposalStatus,
  TaskStatus as PrismaTaskStatus,
  User,
} from '@prisma/client';
import { TaskStatus as SharedTaskStatus } from '@ws-spy/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { EventsGateway } from '../events/events.gateway';
import { ProposalsService, UpdateProposalDraftInput } from './proposals.service';

const VALID_STATUSES = new Set<string>(Object.values(PrismaProposalStatus));
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

interface ProposalPatchBody {
  titulo?: string;
  descripcion?: string | null;
  fechaLimite?: string | null;
  categoria?: string;
  assigneeUserId?: string | null;
}

function parsePatch(body: ProposalPatchBody): UpdateProposalDraftInput {
  const patch: UpdateProposalDraftInput = {};
  if (body.titulo !== undefined) patch.titulo = body.titulo;
  if (body.descripcion !== undefined) patch.descripcion = body.descripcion;
  if (body.categoria !== undefined) patch.categoria = body.categoria;
  if (body.assigneeUserId !== undefined) patch.assigneeUserId = body.assigneeUserId;
  if (body.fechaLimite !== undefined) {
    if (body.fechaLimite === null || body.fechaLimite === '') {
      patch.fechaLimite = null;
    } else {
      if (!ISO_DATE_RE.test(body.fechaLimite)) {
        throw new BadRequestException(
          'fechaLimite debe ser una fecha ISO (YYYY-MM-DD)',
        );
      }
      const date = new Date(body.fechaLimite);
      if (Number.isNaN(date.getTime())) {
        throw new BadRequestException('fechaLimite inválida');
      }
      patch.fechaLimite = date;
    }
  }
  return patch;
}

@Controller('proposals')
export class ProposalsController {
  constructor(
    private readonly proposalsService: ProposalsService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  @Get()
  list(
    @CurrentUser() user: User,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    let statusValue: PrismaProposalStatus | undefined;
    if (status) {
      const upper = status.toUpperCase();
      if (!VALID_STATUSES.has(upper)) {
        throw new BadRequestException(
          `status inválido. Valores aceptados: ${Array.from(VALID_STATUSES).join(', ')}`,
        );
      }
      statusValue = upper as PrismaProposalStatus;
    }

    const parsedLimit = limit ? Number(limit) : undefined;
    if (parsedLimit !== undefined && !Number.isFinite(parsedLimit)) {
      throw new BadRequestException('limit debe ser un número');
    }

    return this.proposalsService.listForUser({
      userId: user.id,
      status: statusValue,
      limit: parsedLimit,
    });
  }

  @Get('count-pending')
  countPending(@CurrentUser() user: User) {
    return this.proposalsService
      .countPendingForUser(user.id)
      .then((count) => ({ count }));
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() user: User) {
    return this.proposalsService.getForUser(id, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: ProposalPatchBody,
    @CurrentUser() user: User,
  ) {
    return this.proposalsService.updateDraft(id, user.id, parsePatch(body));
  }

  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @Body() body: ProposalPatchBody,
    @CurrentUser() user: User,
  ) {
    const { proposal, task } = await this.proposalsService.approve(
      id,
      user.id,
      parsePatch(body),
    );
    this.eventsGateway.emitProposalApproved({
      proposalId: proposal.id,
      creatorUserId: proposal.creatorUserId,
      taskId: task.id,
    });
    this.eventsGateway.emitTaskCreated({
      taskId: task.id,
      assigneeUserId: task.assigneeUserId,
      status: (task.status ?? PrismaTaskStatus.PENDING) as SharedTaskStatus,
    });
    return { proposal, task };
  }

  @Post(':id/discard')
  async discard(@Param('id') id: string, @CurrentUser() user: User) {
    const proposal = await this.proposalsService.discard(id, user.id);
    this.eventsGateway.emitProposalDiscarded({
      proposalId: proposal.id,
      creatorUserId: proposal.creatorUserId,
    });
    return proposal;
  }
}

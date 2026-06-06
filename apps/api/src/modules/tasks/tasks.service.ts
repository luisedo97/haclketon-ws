import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { CreateTaskDto, UpdateTaskDto } from '../../common/dto';
import { TaskStatus as SharedTaskStatus } from '@ws-spy/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';

const TASK_INCLUDE = {
  contact: true,
  assignee: { select: { id: true, displayName: true, role: true } },
};

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  findAll(filters: {
    contactId?: string;
    assigneeUserId?: string;
    status?: string;
  }) {
    const statuses = filters.status
      ?.split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s): s is TaskStatus =>
        (Object.values(TaskStatus) as string[]).includes(s),
      );

    return this.prisma.task.findMany({
      where: {
        ...(filters.contactId ? { contactId: filters.contactId } : {}),
        ...(filters.assigneeUserId
          ? { assigneeUserId: filters.assigneeUserId }
          : {}),
        ...(statuses && statuses.length > 0 ? { status: { in: statuses } } : {}),
      },
      include: TASK_INCLUDE,
      orderBy: { updatedAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.task.findUnique({
      where: { id },
      include: TASK_INCLUDE,
    });
  }

  async create(dto: CreateTaskDto, createdByUserId?: string) {
    if (!dto.contactId && !dto.assigneeUserId) {
      // No es estrictamente requerido (proposal-approve crea con todos los
      // campos opcionales), pero el endpoint manual sí necesita uno u otro.
      throw new BadRequestException(
        'Se requiere contactId o assigneeUserId para crear una tarea',
      );
    }

    if (dto.contactId) {
      const contact = await this.prisma.contact.findUnique({
        where: { id: dto.contactId },
      });
      if (!contact) {
        throw new NotFoundException(`Contact ${dto.contactId} not found`);
      }
    }

    if (dto.assigneeUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: dto.assigneeUserId },
        select: { id: true },
      });
      if (!user) {
        throw new NotFoundException(`User ${dto.assigneeUserId} not found`);
      }
    }

    return this.prisma.task.create({
      data: {
        contactId: dto.contactId,
        assigneeUserId: dto.assigneeUserId,
        createdByUserId: createdByUserId ?? null,
        title: dto.title,
        description: dto.description,
        category: dto.category,
        status: (dto.status as TaskStatus) ?? TaskStatus.PENDING,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
      include: TASK_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateTaskDto) {
    const existing = await this.prisma.task.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Task ${id} not found`);
    }

    if (dto.assigneeUserId !== undefined && dto.assigneeUserId !== null) {
      const user = await this.prisma.user.findUnique({
        where: { id: dto.assigneeUserId },
        select: { id: true },
      });
      if (!user) {
        throw new NotFoundException(`User ${dto.assigneeUserId} not found`);
      }
    }

    const task = await this.prisma.task.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        category: dto.category,
        status: dto.status as TaskStatus | undefined,
        assigneeUserId:
          dto.assigneeUserId === undefined ? undefined : dto.assigneeUserId,
        dueAt:
          dto.dueAt === null ? null : dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
      include: TASK_INCLUDE,
    });

    if (dto.status && dto.status !== existing.status) {
      this.eventsGateway.emitTaskUpdated({
        taskId: task.id,
        status: task.status as SharedTaskStatus,
      });
    }

    return task;
  }

  async remove(id: string) {
    const existing = await this.prisma.task.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Task ${id} not found`);
    }
    return this.prisma.task.delete({ where: { id } });
  }
}

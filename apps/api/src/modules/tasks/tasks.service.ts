import { Injectable, NotFoundException } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { CreateTaskDto, UpdateTaskDto } from '../../common/dto';
import { TaskStatus as SharedTaskStatus } from '@ws-spy/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  findAll(contactId?: string) {
    return this.prisma.task.findMany({
      where: contactId ? { contactId } : undefined,
      include: { contact: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.task.findUnique({
      where: { id },
      include: { contact: true },
    });
  }

  async create(dto: CreateTaskDto) {
    const contact = await this.prisma.contact.findUnique({
      where: { id: dto.contactId },
    });
    if (!contact) {
      throw new NotFoundException(`Contact ${dto.contactId} not found`);
    }

    return this.prisma.task.create({
      data: {
        contactId: dto.contactId,
        title: dto.title,
        description: dto.description,
        status: (dto.status as TaskStatus) ?? TaskStatus.PENDING,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
      include: { contact: true },
    });
  }

  async update(id: string, dto: UpdateTaskDto) {
    const existing = await this.prisma.task.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Task ${id} not found`);
    }

    const task = await this.prisma.task.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status as TaskStatus | undefined,
        dueAt: dto.dueAt === null ? null : dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
      include: { contact: true },
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

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AddMonitoredGroupInput {
  deviceId: string;
  jid: string;
  title?: string | null;
  addedByUserId?: string | null;
}

@Injectable()
export class MonitoredGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async isMonitored(deviceId: string, jid: string): Promise<boolean> {
    if (!jid.endsWith('@g.us')) {
      return false;
    }
    const found = await this.prisma.monitoredGroup.findUnique({
      where: { deviceId_jid: { deviceId, jid } },
      select: { id: true },
    });
    return found !== null;
  }

  list(deviceId?: string) {
    return this.prisma.monitoredGroup.findMany({
      where: deviceId ? { deviceId } : undefined,
      orderBy: { addedAt: 'desc' },
    });
  }

  async add(input: AddMonitoredGroupInput) {
    if (!input.jid.endsWith('@g.us')) {
      throw new BadRequestException(
        'Solo se pueden monitorear JIDs de grupo (terminan en @g.us)',
      );
    }
    const device = await this.prisma.device.findUnique({
      where: { id: input.deviceId },
      select: { id: true },
    });
    if (!device) {
      throw new NotFoundException(`Device ${input.deviceId} not found`);
    }
    return this.prisma.monitoredGroup.upsert({
      where: {
        deviceId_jid: { deviceId: input.deviceId, jid: input.jid },
      },
      create: {
        deviceId: input.deviceId,
        jid: input.jid,
        title: input.title ?? null,
        addedByUserId: input.addedByUserId ?? null,
      },
      update: {
        title: input.title ?? undefined,
      },
    });
  }

  async remove(id: string) {
    const group = await this.prisma.monitoredGroup.findUnique({
      where: { id },
    });
    if (!group) {
      throw new NotFoundException(`MonitoredGroup ${id} not found`);
    }
    await this.prisma.monitoredGroup.delete({ where: { id } });
    return { id };
  }

  async discoverable(deviceId: string) {
    const seen = await this.prisma.conversation.findMany({
      where: {
        deviceId,
        jid: { endsWith: '@g.us' },
      },
      select: { jid: true, title: true, lastMessageAt: true },
      orderBy: { lastMessageAt: 'desc' },
    });
    const monitored = await this.prisma.monitoredGroup.findMany({
      where: { deviceId },
      select: { jid: true },
    });
    const monitoredSet = new Set(monitored.map((m) => m.jid));
    return seen.filter((s) => !monitoredSet.has(s.jid));
  }
}

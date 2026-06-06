import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContactDto } from '../../common/dto';

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.contact.findMany({
      orderBy: { displayName: 'asc' },
    });
  }

  findOne(id: string) {
    return this.prisma.contact.findUnique({
      where: { id },
      include: { tasks: true, conversations: true },
    });
  }

  create(dto: CreateContactDto) {
    return this.prisma.contact.create({
      data: {
        phoneE164: dto.phoneE164,
        displayName: dto.displayName,
        notes: dto.notes,
        deviceId: dto.deviceId,
        isManual: true,
      },
    });
  }

  async remove(id: string) {
    const contact = await this.prisma.contact.findUnique({ where: { id } });
    if (!contact) {
      throw new NotFoundException(`Contact ${id} not found`);
    }
    return this.prisma.contact.delete({ where: { id } });
  }
}

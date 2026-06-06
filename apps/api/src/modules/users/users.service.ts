import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  listLite() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        displayName: true,
        role: true,
        phoneE164: true,
      },
      orderBy: { displayName: 'asc' },
    });
  }
}

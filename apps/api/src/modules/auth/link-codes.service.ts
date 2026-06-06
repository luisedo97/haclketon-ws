import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class LinkCodesService {
  private readonly logger = new Logger(LinkCodesService.name);
  private readonly ttlMin: number;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.ttlMin = Number(
      configService.get<string>('LINK_CODE_TTL_MIN') ?? 15,
    );
  }

  async generate(userId: string) {
    const now = new Date();
    // Invalidar códigos activos previos del mismo usuario.
    await this.prisma.linkCode.updateMany({
      where: {
        userId,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { expiresAt: now },
    });

    const code = await this.generateUniqueCode();
    const expiresAt = new Date(now.getTime() + this.ttlMin * 60_000);
    return this.prisma.linkCode.create({
      data: { code, userId, expiresAt },
    });
  }

  /**
   * Intenta consumir un código. Devuelve el userId vinculado o null si el
   * código no existe / expiró / ya se usó.
   */
  async consume(code: string, fromJid: string): Promise<string | null> {
    const now = new Date();
    const found = await this.prisma.linkCode.findUnique({
      where: { code },
    });
    if (!found) return null;
    if (found.consumedAt) return null;
    if (found.expiresAt.getTime() < now.getTime()) return null;

    await this.prisma.linkCode.update({
      where: { id: found.id },
      data: { consumedAt: now, consumedJid: fromJid },
    });
    this.logger.log(
      `Código ${code} consumido por user ${found.userId} desde ${fromJid}`,
    );
    return found.userId;
  }

  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = Math.floor(100000 + Math.random() * 900000).toString();
      const exists = await this.prisma.linkCode.findUnique({
        where: { code: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    throw new Error('No se pudo generar un código único tras 10 intentos');
  }
}

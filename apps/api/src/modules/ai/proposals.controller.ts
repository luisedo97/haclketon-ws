import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { ProposalStatus as PrismaProposalStatus } from '@prisma/client';
import { ProposalsService } from './proposals.service';

const VALID_STATUSES = new Set<string>(
  Object.values(PrismaProposalStatus),
);

@Controller('proposals')
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  @Get()
  list(
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

    return this.proposalsService.list({
      status: statusValue,
      limit: parsedLimit,
    });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.proposalsService.getDetail(id);
  }
}

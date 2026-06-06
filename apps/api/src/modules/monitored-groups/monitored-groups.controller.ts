import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role, User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { MonitoredGroupsService } from './monitored-groups.service';

interface AddBody {
  deviceId?: string;
  jid?: string;
  title?: string | null;
}

@Controller('monitored-groups')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class MonitoredGroupsController {
  constructor(private readonly service: MonitoredGroupsService) {}

  @Get()
  list(@Query('deviceId') deviceId?: string) {
    return this.service.list(deviceId);
  }

  @Get('discoverable')
  discoverable(@Query('deviceId') deviceId?: string) {
    if (!deviceId) {
      throw new BadRequestException('Se requiere deviceId');
    }
    return this.service.discoverable(deviceId);
  }

  @Post()
  add(@Body() body: AddBody, @CurrentUser() user: User) {
    if (!body.deviceId || !body.jid) {
      throw new BadRequestException('deviceId y jid son requeridos');
    }
    return this.service.add({
      deviceId: body.deviceId,
      jid: body.jid,
      title: body.title ?? null,
      addedByUserId: user.id,
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { MonitoredGroupsService } from './monitored-groups.service';

// TODO(F02S02): proteger todos estos endpoints con guard de rol admin.

interface AddBody {
  deviceId?: string;
  jid?: string;
  title?: string | null;
}

@Controller('monitored-groups')
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
  add(@Body() body: AddBody) {
    if (!body.deviceId || !body.jid) {
      throw new BadRequestException('deviceId y jid son requeridos');
    }
    return this.service.add({
      deviceId: body.deviceId,
      jid: body.jid,
      title: body.title ?? null,
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

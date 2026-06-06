import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CreateDeviceDto } from '../../common/dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { WhatsappService } from './whatsapp.service';

@Controller('devices')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get()
  findAll() {
    return this.whatsappService.findAllDevices();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.whatsappService.findDevice(id);
  }

  @Post()
  create(@Body() dto: CreateDeviceDto) {
    return this.whatsappService.createDevice(dto);
  }

  @Post(':id/connect')
  connect(@Param('id') id: string) {
    return this.whatsappService.connect(id);
  }

  @Post(':id/disconnect')
  disconnect(@Param('id') id: string) {
    return this.whatsappService.disconnect(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.whatsappService.removeDevice(id);
  }
}

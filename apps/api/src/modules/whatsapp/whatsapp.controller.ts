import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { CreateDeviceDto } from '../../common/dto';
import { WhatsappService } from './whatsapp.service';

@Controller('devices')
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

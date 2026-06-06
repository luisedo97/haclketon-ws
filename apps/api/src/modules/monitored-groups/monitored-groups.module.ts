import { Module } from '@nestjs/common';
import { MonitoredGroupsController } from './monitored-groups.controller';
import { MonitoredGroupsService } from './monitored-groups.service';

@Module({
  controllers: [MonitoredGroupsController],
  providers: [MonitoredGroupsService],
  exports: [MonitoredGroupsService],
})
export class MonitoredGroupsModule {}

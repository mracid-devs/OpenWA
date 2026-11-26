import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperatorProfile } from './entities/operator-profile.entity';
import { PortalLogSettings } from './entities/portal-log-settings.entity';
import { OperatorService } from './operator.service';
import { PortalLogService } from './portal-log.service';
import { OperatorController } from './operator.controller';
import { MessageModule } from '../message/message.module';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [TypeOrmModule.forFeature([OperatorProfile, PortalLogSettings], 'data'), MessageModule, SessionModule],
  controllers: [OperatorController],
  providers: [OperatorService, PortalLogService],
  exports: [OperatorService, PortalLogService],
})
export class OperatorModule {}

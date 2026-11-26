import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentApiKey, RequireRole, RequireUnscopedKey } from '../auth/decorators/auth.decorators';
import { type ApiKey, ApiKeyRole } from '../auth/entities/api-key.entity';
import { OperatorService } from './operator.service';
import { PortalLogService } from './portal-log.service';
import {
  OperatorMeResponseDto,
  OperatorProfileResponseDto,
  PortalLogResponseDto,
  PortalLogTestResponseDto,
  SetOperatorNameDto,
  UpdatePortalLogDto,
} from './dto/operator.dto';

const ctxOf = (req: Request) => ({
  ipAddress: (req as Request & { clientIp?: string }).clientIp ?? undefined,
  method: req.method,
  path: req.path,
});

@ApiTags('operator')
@Controller('operator')
export class OperatorController {
  constructor(
    private readonly operators: OperatorService,
    private readonly portalLog: PortalLogService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'The name this key signs its replies with, and whether it can still be changed' })
  @ApiResponse({ status: 200, type: OperatorMeResponseDto })
  me(@CurrentApiKey() apiKey: ApiKey) {
    return this.operators.me(apiKey);
  }

  @Put('me')
  @ApiOperation({
    summary: 'Set the name this key signs its replies with',
    description: 'Open the first time; after that only an administrator can change it.',
  })
  @ApiResponse({ status: 200, type: OperatorMeResponseDto })
  @ApiResponse({ status: 403, description: 'A name is already set and only an administrator can change it' })
  setMe(@CurrentApiKey() apiKey: ApiKey, @Body() dto: SetOperatorNameDto, @Req() req: Request) {
    return this.operators.setOwn(apiKey, dto.name, ctxOf(req));
  }

  @Get('profiles')
  @RequireUnscopedKey()
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Every API key with the name it signs replies with (admin only)' })
  @ApiResponse({ status: 200, type: [OperatorProfileResponseDto] })
  profiles() {
    return this.operators.list();
  }

  @Put('profiles/:apiKeyId')
  @RequireUnscopedKey()
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Change the name of any API key (admin only)' })
  @ApiResponse({ status: 200, type: OperatorMeResponseDto })
  setFor(
    @CurrentApiKey() apiKey: ApiKey,
    @Param('apiKeyId') apiKeyId: string,
    @Body() dto: SetOperatorNameDto,
    @Req() req: Request,
  ) {
    return this.operators.setFor(apiKey, apiKeyId, dto.name, ctxOf(req));
  }

  @Get('portal-log')
  @RequireUnscopedKey()
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Where portal activity is mirrored in WhatsApp (admin only)' })
  @ApiResponse({ status: 200, type: PortalLogResponseDto })
  async getPortalLog(): Promise<PortalLogResponseDto> {
    const s = await this.portalLog.getSettings();
    return { enabled: s.enabled, sessionId: s.sessionId, groupId: s.groupId, groupName: s.groupName };
  }

  @Put('portal-log')
  @RequireUnscopedKey()
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Choose the WhatsApp group that mirrors portal activity (admin only)' })
  @ApiResponse({ status: 200, type: PortalLogResponseDto })
  async setPortalLog(
    @CurrentApiKey() apiKey: ApiKey,
    @Body() dto: UpdatePortalLogDto,
    @Req() req: Request,
  ): Promise<PortalLogResponseDto> {
    const s = await this.portalLog.update(apiKey, dto, ctxOf(req));
    return { enabled: s.enabled, sessionId: s.sessionId, groupId: s.groupId, groupName: s.groupName };
  }

  @Post('portal-log/test')
  @RequireUnscopedKey()
  @RequireRole(ApiKeyRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Post a test line to the activity log group (admin only)' })
  @ApiResponse({ status: 200, type: PortalLogTestResponseDto })
  async testPortalLog(@CurrentApiKey() apiKey: ApiKey): Promise<PortalLogTestResponseDto> {
    await this.portalLog.sendTest(apiKey);
    return { sent: true };
  }
}

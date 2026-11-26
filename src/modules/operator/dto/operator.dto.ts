import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ToStrictBoolean, ToStrictString } from '../../../common/utils/strict-boolean';

export const OPERATOR_NAME_MAX = 40;

export class SetOperatorNameDto {
  @ApiProperty({
    description: 'The name that leads the replies sent with this key (1-40 characters, no line breaks)',
    example: 'Viraj',
    maxLength: OPERATOR_NAME_MAX,
  })
  @ToStrictString()
  @IsString()
  @MinLength(1)
  @MaxLength(OPERATOR_NAME_MAX)
  name!: string;
}

export class OperatorMeResponseDto {
  @ApiProperty() apiKeyId!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ description: 'A name is set: from now on only an administrator can change it' }) locked!: boolean;
  @ApiProperty({ description: 'This key may change the name now' }) canChange!: boolean;
}

export class OperatorProfileResponseDto {
  @ApiProperty() apiKeyId!: string;
  @ApiPropertyOptional({ type: String }) apiKeyName?: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiPropertyOptional() updatedAt?: Date;
}

export class UpdatePortalLogDto {
  @ApiProperty({ description: 'Mirror portal activity to the WhatsApp group' })
  @ToStrictBoolean()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ description: 'The session that posts to the group', nullable: true })
  @IsOptional()
  @ToStrictString()
  @IsString()
  @MaxLength(36)
  sessionId?: string | null;

  @ApiPropertyOptional({ description: 'The group chat id (…@g.us)', nullable: true })
  @IsOptional()
  @ToStrictString()
  @IsString()
  @MaxLength(100)
  @Matches(/^[0-9A-Za-z._-]+@g\.us$/, { message: 'groupId must be a WhatsApp group id ending in @g.us' })
  groupId?: string | null;

  @ApiPropertyOptional({ description: 'The group name, shown back in Settings', nullable: true })
  @IsOptional()
  @ToStrictString()
  @IsString()
  @MaxLength(200)
  groupName?: string | null;
}

export class PortalLogResponseDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ nullable: true, type: String }) sessionId!: string | null;
  @ApiProperty({ nullable: true, type: String }) groupId!: string | null;
  @ApiProperty({ nullable: true, type: String }) groupName!: string | null;
}

export class PortalLogTestResponseDto {
  @ApiProperty() sent!: boolean;
}

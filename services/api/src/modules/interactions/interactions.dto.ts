import { IsString, IsOptional, IsNumber, IsDateString, IsEnum, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';

export enum InteractionType {
  CALL = 'call',
  MESSAGE = 'message',
  MEETING = 'meeting',
  NOTE = 'note',
  EMAIL = 'email',
  SOCIAL = 'social',
}

export class CreateInteractionDto {
  @ApiProperty({ example: '019abc...' })
  @IsString()
  contactId: string;

  @ApiProperty({ enum: InteractionType, example: InteractionType.MEETING })
  @IsEnum(InteractionType)
  type: InteractionType;

  @ApiPropertyOptional({ example: 'Coffee at Starbucks' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'Discussed potential collaboration on AI project' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  duration?: number;

  @ApiPropertyOptional({ example: 'Starbucks KL' })
  @IsOptional()
  @IsString()
  location?: string;
}

export class CreateContactInteractionDto extends OmitType(
  CreateInteractionDto,
  ['contactId'] as const,
) {}

export class InteractionQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactId?: string;

  @ApiPropertyOptional({ enum: InteractionType })
  @IsOptional()
  @IsEnum(InteractionType)
  type?: InteractionType;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsNumber()
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  offset?: number;
}

export class LogInteractionResponseDto {
  @ApiProperty()
  interaction: {
    id: string;
    type: string;
    title: string | null;
    occurredAt: Date;
    xpEarned: number;
  };

  @ApiProperty()
  user: {
    xp: number;
    level: number;
    xpToNextLevel: number;
  };

  @ApiPropertyOptional()
  newAchievements?: string[];
}

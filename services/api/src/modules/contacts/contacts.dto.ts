import {
  IsString,
  IsOptional,
  IsArray,
  IsDateString,
  IsNumber,
  IsObject,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateContactDto {
  @ApiProperty({ example: 'John' })
  @IsString()
  firstName: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  photo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  company?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  jobTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  birthday?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  anniversary?: string;

  @ApiPropertyOptional({ example: ['Networking', 'Tech'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labels?: string[];

  @ApiPropertyOptional({ example: ['KL', 'Startup'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  firstMetDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firstMetContext?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vaultId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  importance?: number;

  @ApiPropertyOptional({ minimum: 7, maximum: 365, default: 90 })
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(365)
  preferredCadenceDays?: number;
}

export class UpdateContactDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  photo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  company?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  jobTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  birthday?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  anniversary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labels?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  relationshipScore?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  importance?: number;

  @ApiPropertyOptional({ minimum: 7, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(365)
  preferredCadenceDays?: number;
}

export class ContactFieldDto {
  @ApiProperty({ example: 'email' })
  @IsString()
  type: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsString()
  value: string;

  @ApiPropertyOptional({ example: 'work' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  isPrimary?: boolean;
}

export class ContactQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'Networking' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ example: 'KL' })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vaultId?: string;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @IsNumber()
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  offset?: number;

  @ApiPropertyOptional({ example: 'lastContactedAt' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ example: 'desc' })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}

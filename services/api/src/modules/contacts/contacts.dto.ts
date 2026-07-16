import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const CONTACT_FIELD_TYPES = ['email', 'phone', 'address', 'website', 'other'] as const;

export enum ContactSortBy {
  CREATED_AT = 'createdAt',
  FIRST_NAME = 'firstName',
  LAST_CONTACTED_AT = 'lastContactedAt',
  RELATIONSHIP_SCORE = 'relationshipScore',
  NEXT_REMINDER_AT = 'nextReminderAt',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

const SOCIAL_LINK_OPTIONS = {
  protocols: ['http', 'https'],
  require_protocol: true,
  require_valid_protocol: true,
};

export class SocialLinksDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl(SOCIAL_LINK_OPTIONS)
  linkedin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl(SOCIAL_LINK_OPTIONS)
  twitter?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl(SOCIAL_LINK_OPTIONS)
  instagram?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl(SOCIAL_LINK_OPTIONS)
  facebook?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl(SOCIAL_LINK_OPTIONS)
  github?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl(SOCIAL_LINK_OPTIONS)
  website?: string;
}

export class ContactFieldDto {
  @ApiProperty({ example: 'email', enum: CONTACT_FIELD_TYPES })
  @IsString()
  @IsIn(CONTACT_FIELD_TYPES)
  type: string;

  @ApiProperty({ example: 'person@example.test', maxLength: 2048 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(2048)
  value: string;

  @ApiPropertyOptional({ example: 'work', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class CreateContactDto {
  @ApiProperty({ example: 'Synthetic' })
  @IsString()
  firstName: string;

  @ApiPropertyOptional({ example: 'Person' })
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

  @ApiPropertyOptional({ example: ['Mentors'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groups?: string[];

  @ApiPropertyOptional({ type: SocialLinksDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
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

  @ApiPropertyOptional({ type: [ContactFieldDto], maxItems: 20 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ContactFieldDto)
  contactFields?: ContactFieldDto[];
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

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsDateString()
  birthday?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsDateString()
  anniversary?: string | null;

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
  @IsArray()
  @IsString({ each: true })
  groups?: string[];

  @ApiPropertyOptional({ type: SocialLinksDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsDateString()
  firstMetDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  firstMetContext?: string | null;

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

  @ApiPropertyOptional({ type: [ContactFieldDto], maxItems: 20 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ContactFieldDto)
  contactFields?: ContactFieldDto[];
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

  @ApiPropertyOptional({ example: 'Mentors' })
  @IsOptional()
  @IsString()
  group?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vaultId?: string;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ enum: ContactSortBy })
  @IsOptional()
  @IsEnum(ContactSortBy)
  sortBy?: ContactSortBy;

  @ApiPropertyOptional({ enum: SortOrder })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder;
}

import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

function PreserveJsonType(): PropertyDecorator {
  return Transform(({ obj, key }) => (obj as Record<string, unknown>)[key], {
    toClassOnly: true,
  });
}

export class CreateEventSourceDto {
  @PreserveJsonType()
  @IsString()
  @MaxLength(500)
  name!: string;

  @PreserveJsonType()
  @IsString()
  @MaxLength(4096)
  feedUrl!: string;

  @PreserveJsonType()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  city?: string | null;

  @PreserveJsonType()
  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string | null;

  @PreserveJsonType()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  socialWeight?: number;

  @PreserveJsonType()
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1440)
  pollIntervalMinutes?: number;
}

export class UpdateEventSourceDto {
  @PreserveJsonType()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  name?: string;

  @PreserveJsonType()
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  feedUrl?: string;

  @PreserveJsonType()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  city?: string | null;

  @PreserveJsonType()
  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string | null;

  @PreserveJsonType()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  socialWeight?: number;

  @PreserveJsonType()
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1440)
  pollIntervalMinutes?: number;

  @PreserveJsonType()
  @IsOptional()
  @IsIn(["active", "disabled"])
  status?: "active" | "disabled";
}

export class UpsertEventPreferenceDto {
  @PreserveJsonType()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  interestTags!: string[];

  @PreserveJsonType()
  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(1)
  @Max(500)
  maxDistanceKm?: number;

  @PreserveJsonType()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  travelSpeedKph?: number;

  @PreserveJsonType()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  travelBufferMinutes?: number;
}

export type AuthenticatedEventRequest = { user: { userId: string } };

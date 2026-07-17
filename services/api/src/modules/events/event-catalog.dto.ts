import { Transform, Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

function PreserveJsonType(): PropertyDecorator {
  return Transform(({ obj, key }) => (obj as Record<string, unknown>)[key], {
    toClassOnly: true,
  });
}

export class EventCatalogQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  tags?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  kind?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  trust?: string;

  @IsOptional()
  @IsIn(["true", "false"])
  followed?: "true" | "false";

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/)
  @MaxLength(400)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

export class PutEventCatalogFollowDto {
  @PreserveJsonType()
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(10)
  socialWeight?: number;
}

export class PatchEventCatalogFollowDto {
  @PreserveJsonType()
  @IsIn(["active", "paused"])
  status!: "active" | "paused";

  @PreserveJsonType()
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(10)
  socialWeight?: number;
}

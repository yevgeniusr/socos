import {
  IsIn,
  IsInt,
  IsNumber,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from "class-validator";
import { Exclude, Expose, Transform } from "class-transformer";

const OWNTRACKS_TRIGGERS = [
  "p",
  "c",
  "b",
  "r",
  "u",
  "t",
  "v",
  "C",
  "m",
  "e",
] as const;

@ValidatorConstraint({ name: "notTooFarInFuture", async: false })
class NotTooFarInFuture implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value <= Math.floor(Date.now() / 1_000) + 600
    );
  }

  defaultMessage(): string {
    return "tst must not be more than 10 minutes in the future";
  }
}

@ValidatorConstraint({ name: "validCourse", async: false })
class ValidCourse implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value < 360
    );
  }
}

@ValidatorConstraint({ name: "nonBlank", async: false })
class NonBlank implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === "string" && value.trim().length > 0;
  }
}

@ValidatorConstraint({ name: "ianaTimeZone", async: false })
class IanaTimeZone implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== "string" || value.trim() !== value) return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }
}

@Exclude({ toClassOnly: true })
export class OwnTracksLocationDto {
  @PreserveJsonType()
  @IsIn(["location"])
  _type!: "location";

  @PreserveJsonType()
  @IsInt()
  @Min(0)
  @Validate(NotTooFarInFuture)
  tst!: number;

  @PreserveJsonType()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  lat!: number;

  @PreserveJsonType()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  lon!: number;

  @PreserveJsonType()
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  acc?: number;

  @PreserveJsonType()
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  alt?: number;

  @PreserveJsonType()
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  vel?: number;

  @PreserveJsonType()
  @ValidateIf((_object, value) => value !== undefined)
  @Validate(ValidCourse)
  cog?: number;

  @PreserveJsonType()
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100)
  batt?: number;

  @PreserveJsonType()
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(OWNTRACKS_TRIGGERS)
  t?: string;

  @PreserveJsonType()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(2, 2)
  tid?: string;
}

export class CreateLocationDeviceDto {
  @PreserveJsonType()
  @IsString()
  @Length(1, 80)
  name!: string;

  @PreserveJsonType()
  @IsString()
  @Length(1, 128)
  externalDeviceId!: string;

  @PreserveJsonType()
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(30)
  @Max(365)
  rawRetentionDays?: number;

  @PreserveJsonType()
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(90)
  @Max(3650)
  derivedRetentionDays?: number;
}

export class CreateLocationAliasDto {
  @PreserveJsonType()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Validate(NonBlank)
  alias!: string;

  @PreserveJsonType()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Validate(NonBlank)
  city!: string;

  @PreserveJsonType()
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  countryCode!: string;

  @PreserveJsonType()
  @IsString()
  @MaxLength(100)
  @Validate(IanaTimeZone)
  timeZone!: string;
}

export class UpdateLocationAliasDto {
  @PreserveJsonType()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Validate(NonBlank)
  alias?: string;

  @PreserveJsonType()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Validate(NonBlank)
  city?: string;

  @PreserveJsonType()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @PreserveJsonType()
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  @Validate(IanaTimeZone)
  timeZone?: string;
}

export type AuthenticatedOwnerRequest = { user: { userId: string } };

export type AuthenticatedLocationDevice = {
  id: string;
  ownerId: string;
  username: string;
};

function PreserveJsonType(): PropertyDecorator {
  return (target, propertyKey) => {
    Expose({ toClassOnly: true })(target, propertyKey);
    Transform(({ obj, key }) => (obj as Record<string, unknown>)[key], {
      toClassOnly: true,
    })(target, propertyKey);
  };
}

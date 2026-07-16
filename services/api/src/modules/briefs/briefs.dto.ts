import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export type BriefItemFeedbackAction = "accept" | "snooze" | "dismiss";

export class BriefItemFeedbackDto {
  @IsIn(["accept", "snooze", "dismiss"])
  action: BriefItemFeedbackAction;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  snoozedUntil?: string;
}

export class QuestCompletionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  interactionId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reminderId?: string;
}

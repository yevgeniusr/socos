import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

export type ProposalHistoryStatus =
  | "all"
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

export class ApprovalHistoryQueryDto {
  @IsOptional()
  @IsIn(["all", "pending", "approved", "rejected", "expired"])
  status: ProposalHistoryStatus = "all";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}

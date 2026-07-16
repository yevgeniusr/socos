import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard.js";
import { BriefFeedbackService } from "./brief-feedback.service.js";
import { BriefGeneratorService } from "./brief-generator.service.js";
import { BriefItemFeedbackDto, QuestCompletionDto } from "./briefs.dto.js";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

interface AuthenticatedRequest {
  user: { userId: string };
}

@ApiTags("briefs")
@Controller("briefs")
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class BriefsController {
  constructor(
    private readonly generator: BriefGeneratorService,
    private readonly feedback: BriefFeedbackService
  ) {}

  @Get("today")
  @ApiOperation({ summary: "Get today's ready social brief" })
  async today(@Request() request: AuthenticatedRequest) {
    const brief = await this.generator.getReadyForOwner(
      request.user.userId,
      new Date()
    );
    if (!brief) {
      throw new NotFoundException({
        code: "BRIEF_NOT_READY",
        message: "Today's brief is not ready.",
      });
    }
    return brief;
  }

  @Post("generate")
  @ApiOperation({ summary: "Generate or retrieve today's social brief" })
  generate(@Request() request: AuthenticatedRequest) {
    return this.generator.generateForOwner(request.user.userId, new Date());
  }

  @Post("items/:itemId/feedback")
  @ApiOperation({ summary: "Record an item feedback action" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  recordItemFeedback(
    @Request() request: AuthenticatedRequest,
    @Param("itemId") itemId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() dto: BriefItemFeedbackDto
  ) {
    assertIdempotencyKey(idempotencyKey);
    return this.feedback.recordItemFeedback(
      request.user.userId,
      itemId,
      idempotencyKey,
      dto
    );
  }

  @Post("quests/:questId/complete")
  @ApiOperation({ summary: "Complete a quest with verified CRM evidence" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  completeQuest(
    @Request() request: AuthenticatedRequest,
    @Param("questId") questId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() dto: QuestCompletionDto
  ) {
    assertIdempotencyKey(idempotencyKey);
    return this.feedback.completeQuest(
      request.user.userId,
      questId,
      idempotencyKey,
      dto
    );
  }
}

function assertIdempotencyKey(value: unknown): asserts value is string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new BadRequestException("Invalid Idempotency-Key");
  }
}

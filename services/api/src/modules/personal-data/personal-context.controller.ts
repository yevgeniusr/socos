import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Headers,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard.js";
import { PersonalContextDeletionService } from "./personal-context-deletion.service.js";

const CONFIRMATION = "DELETE_PERSONAL_CONTEXT";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

interface AuthenticatedRequest {
  user: { userId: string };
}

@ApiTags("personal-context")
@ApiBearerAuth()
@Controller("personal-context")
@UseGuards(AuthGuard)
export class PersonalContextController {
  constructor(private readonly deletion: PersonalContextDeletionService) {}

  @Delete()
  @ApiHeader({ name: "Idempotency-Key", required: true })
  async deletePersonalContext(
    @Request() request: AuthenticatedRequest,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() body: unknown
  ) {
    assertIdempotencyKey(idempotencyKey);
    assertConfirmationBody(body);
    return this.deletion.deletePersonalContext(
      request.user.userId,
      idempotencyKey,
      body
    );
  }
}

function assertIdempotencyKey(value: unknown): asserts value is string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new BadRequestException("Invalid Idempotency-Key");
  }
}

function assertConfirmationBody(
  value: unknown
): asserts value is { confirmation: typeof CONFIRMATION } {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    (value as { confirmation?: unknown }).confirmation !== CONFIRMATION
  ) {
    throw new BadRequestException("Invalid confirmation");
  }
}

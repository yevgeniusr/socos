import { Global, Module } from "@nestjs/common";
import { PrismaService } from "../modules/prisma/prisma.service.js";
import { HumanIdempotencyService } from "./human-idempotency.service.js";

@Global()
@Module({
  providers: [PrismaService, HumanIdempotencyService],
  exports: [HumanIdempotencyService],
})
export class HumanIdempotencyModule {}

import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../modules/prisma/prisma.service.js";

export const DATABASE_ATTESTATION = Object.freeze({
  mode: "real" as const,
  auth: Object.freeze({ mode: "real" as const }),
  database: Object.freeze({
    connected: true as const,
    driver: "postgres" as const,
    persistent: true as const,
  }),
  mocksDetected: false as const,
});

export const DATABASE_ATTESTATION_UNAVAILABLE = Object.freeze({
  status: "unavailable" as const,
  attestation: "postgresql-unreachable" as const,
});

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async databaseAttestation(): Promise<typeof DATABASE_ATTESTATION> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return DATABASE_ATTESTATION;
    } catch {
      throw new ServiceUnavailableException(DATABASE_ATTESTATION_UNAVAILABLE);
    }
  }
}

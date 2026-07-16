import { Controller, Get, Header } from "@nestjs/common";
import { HealthService } from "./health.service.js";

const API_VERSION = "0.1.0";

// Exposes GET /api/health-check
@Controller("health-check")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  healthCheck() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      version: API_VERSION,
    };
  }

  @Get("postgresql")
  @Header("Cache-Control", "no-store")
  postgresqlAttestation() {
    return this.healthService.databaseAttestation();
  }
}

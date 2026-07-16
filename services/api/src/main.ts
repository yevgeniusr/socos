import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';
import { createApplicationValidationPipe } from './common/application-validation.pipe.js';
import { configureLocationBodyParsers } from './modules/location/location-raw-body.middleware.js';

// Initialize Sentry before anything else
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: 0.1,
  // Don't fail if DSN is not set — allow graceful no-op
  enabled: Boolean(process.env.SENTRY_DSN),
  debug: false,
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureLocationBodyParsers(app.getHttpAdapter().getInstance());

  // Set global prefix for all routes (required for Traefik routing)
  app.setGlobalPrefix('api');

  // Enable validation
  app.useGlobalPipes(createApplicationValidationPipe());

  // Global exception filter — ensures HTTP exceptions return correct status codes (401, etc.)
  // Also reports errors to Sentry
  app.useGlobalFilters(new AllExceptionsFilter());



  // Enable CORS
  app.enableCors();

  // Setup Swagger
  const config = new DocumentBuilder()
    .setTitle('SOCOS API')
    .setDescription('Social Operating System API - Gamified Personal CRM')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Health check available at: http://localhost:${port}/api/health-check`);
  console.log(`Swagger docs available at: http://localhost:${port}/api`);
}
bootstrap();

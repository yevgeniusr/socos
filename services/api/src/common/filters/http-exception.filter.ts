import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/node';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';
    let errors: string[] | undefined;
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string) || exception.message;
        if (typeof resp.code === 'string') code = resp.code;
        if (Array.isArray(resp.message)) {
          errors = resp.message;
          message = 'Validation failed';
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled exception: ${exception.message}`,
        exception.stack,
      );
      message = process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : exception.message;
    }

    // Report non-HTTP exceptions to Sentry
    if (!(exception instanceof HttpException) && exception instanceof Error) {
      Sentry.captureException(exception, {
        contexts: {
          request: {
            method: request.method,
            url: request.url,
            headers: request.headers,
          },
        },
      });
    }

    response.status(status).json({
      statusCode: status,
      ...(code ? { code } : {}),
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}

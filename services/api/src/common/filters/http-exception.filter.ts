import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import * as Sentry from "@sentry/node";

const REDACTED_HEADER_VALUE = "[REDACTED]";
const CREDENTIAL_HEADER_NAME =
  /(?:^|[-_])(?:auth|authorization|cookie|credential|secret|token|session|password|passwd|api[-_]?key|access[-_]?key|private[-_]?key)(?:$|[-_])/i;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestPath = safeRequestPath(request);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = "Internal server error";
    let errors: string[] | undefined;
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === "string") {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === "object") {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string) || exception.message;
        if (typeof resp.code === "string") code = resp.code;
        if (Array.isArray(resp.message)) {
          errors = resp.message;
          message = "Validation failed";
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled exception: ${exception.message}`,
        exception.stack
      );
      message =
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : exception.message;
    }

    // Report non-HTTP exceptions to Sentry
    if (!(exception instanceof HttpException) && exception instanceof Error) {
      Sentry.captureException(exception, {
        contexts: {
          request: {
            method: request.method,
            url: requestPath,
            headers: redactCredentialHeaders(request.headers),
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
      path: requestPath,
    });
  }
}

function safeRequestPath(request: Request): string {
  if (typeof request.path === "string" && request.path.startsWith("/")) {
    return request.path.split(/[?#]/, 1)[0];
  }
  const raw = request.originalUrl || request.url || "/";
  try {
    return new URL(raw, "http://localhost").pathname;
  } catch {
    return raw.split(/[?#]/, 1)[0] || "/";
  }
}

function redactCredentialHeaders(
  headers: Request["headers"]
): Record<string, string | string[] | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      CREDENTIAL_HEADER_NAME.test(name) ? REDACTED_HEADER_VALUE : value,
    ])
  );
}

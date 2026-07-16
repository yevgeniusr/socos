import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { SafeProviderError } from "../safe-provider-error.js";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestPath = safeRequestPath(request);
    const requestContext = safeRequestContext(request, requestPath);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = "Internal server error";
    let errors: string[] | undefined;
    let code: string | undefined;

    if (exception instanceof SafeProviderError) {
      status = HttpStatus.BAD_GATEWAY;
      message = exception.message;
      code = exception.code;
    } else if (exception instanceof HttpException) {
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
      code = "internal_error";
      message = "Internal server error";
    }

    if (exception instanceof SafeProviderError) {
      Sentry.withIsolationScope((isolationScope) => {
        isolationScope.clear();
        Sentry.withScope((scope) => {
          scope.clear();
          scope.addEventProcessor((event) => ({
            ...event,
            request: requestContext,
          }));
          scope.setContext("request", requestContext);
          scope.setTag("safe_error_code", exception.code);
          Sentry.captureMessage("safe_provider_error");
        });
      });
    } else if (
      !(exception instanceof HttpException) &&
      exception instanceof Error
    ) {
      Sentry.captureMessage("internal_error", {
        contexts: {
          request: requestContext,
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

function safeRequestContext(request: Request, requestPath: string) {
  return {
    method: request.method,
    url: requestPath,
  };
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

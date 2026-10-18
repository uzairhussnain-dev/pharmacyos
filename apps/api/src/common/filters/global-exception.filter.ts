import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { ErrorCodes } from '../errors';
import { isDuplicateKeyError } from '../mongo-errors';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
  timestamp: string;
  path: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = (req.headers['x-request-id'] as string | undefined) ?? req.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCodes.INTERNAL;
    let message = 'An unexpected error occurred';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        message = Array.isArray(b.message) ? 'Validation failed' : ((b.message as string) ?? exception.message);
        details = Array.isArray(b.message) ? b.message : b.details;
        code = (b.code as string) ?? defaultCodeForStatus(status);
      }
      if (!code || code === ErrorCodes.INTERNAL) code = defaultCodeForStatus(status);
    } else if (isDuplicateKeyError(exception)) {
      status = HttpStatus.CONFLICT;
      code = ErrorCodes.DUPLICATE_KEY;
      const keys = Object.keys(exception.keyPattern ?? {});
      message = `A record with the same ${keys.join(', ') || 'key'} already exists`;
      details = { fields: keys };
    } else if (exception instanceof mongoose.Error.ValidationError) {
      status = HttpStatus.BAD_REQUEST;
      code = ErrorCodes.VALIDATION_FAILED;
      message = 'Validation failed';
      details = Object.values(exception.errors).map((e) => e.message);
    } else if (exception instanceof mongoose.Error.CastError) {
      status = HttpStatus.BAD_REQUEST;
      code = ErrorCodes.VALIDATION_FAILED;
      message = `Invalid value for ${exception.path}`;
    } else {
      this.logger.error(
        { requestId, path: req.url, err: exception instanceof Error ? exception.stack : exception },
        'Unhandled exception',
      );
      if (process.env.NODE_ENV !== 'production' && exception instanceof Error) {
        details = { name: exception.name, message: exception.message };
      }
    }

    const body: ErrorBody = {
      statusCode: status,
      code,
      message,
      details,
      requestId,
      timestamp: new Date().toISOString(),
      path: req.url,
    };
    res.status(status).json(body);
  }
}

function defaultCodeForStatus(status: number): string {
  switch (status) {
    case 400:
      return ErrorCodes.VALIDATION_FAILED;
    case 401:
      return ErrorCodes.UNAUTHORIZED;
    case 403:
      return ErrorCodes.FORBIDDEN;
    case 404:
      return ErrorCodes.NOT_FOUND;
    case 409:
      return ErrorCodes.CONFLICT;
    case 429:
      return ErrorCodes.RATE_LIMITED;
    default:
      return ErrorCodes.INTERNAL;
  }
}

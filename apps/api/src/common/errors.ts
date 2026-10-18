import { HttpException, HttpStatus } from '@nestjs/common';

/** Stable, machine-readable error codes exposed to clients. */
export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  DUPLICATE_KEY: 'DUPLICATE_KEY',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL_ERROR',
  // domain
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  BATCH_INELIGIBLE: 'BATCH_INELIGIBLE',
  PRODUCT_INACTIVE: 'PRODUCT_INACTIVE',
  RESTRICTED_SALE: 'RESTRICTED_SALE',
  NO_OPEN_CASH_SESSION: 'NO_OPEN_CASH_SESSION',
  CASH_SESSION_ALREADY_OPEN: 'CASH_SESSION_ALREADY_OPEN',
  IDEMPOTENCY_MISMATCH: 'IDEMPOTENCY_MISMATCH',
  IDEMPOTENCY_IN_PROGRESS: 'IDEMPOTENCY_IN_PROGRESS',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  RETURN_EXCEEDS_SOLD: 'RETURN_EXCEEDS_SOLD',
  REFUND_EXCEEDS_PAID: 'REFUND_EXCEEDS_PAID',
  PAYMENT_MISMATCH: 'PAYMENT_MISMATCH',
  DISCOUNT_NOT_ALLOWED: 'DISCOUNT_NOT_ALLOWED',
  CREDIT_LIMIT_EXCEEDED: 'CREDIT_LIMIT_EXCEEDED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export class NotFoundError extends AppException {
  constructor(entity: string, id?: string) {
    super(ErrorCodes.NOT_FOUND, id ? `${entity} ${id} not found` : `${entity} not found`, HttpStatus.NOT_FOUND);
  }
}

export class ConflictError extends AppException {
  constructor(message: string, code: ErrorCode = ErrorCodes.CONFLICT, details?: unknown) {
    super(code, message, HttpStatus.CONFLICT, details);
  }
}

export class ForbiddenError extends AppException {
  constructor(message = 'You do not have permission to perform this action') {
    super(ErrorCodes.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }
}

export class DomainError extends AppException {
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}

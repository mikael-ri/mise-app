import { randomUUID } from 'node:crypto';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ERROR_STATUS } from '@mise/contracts';
import type { ErrorBody, ErrorCode } from '@mise/contracts';

/** Thrown by services and handlers; the global handler turns it into the standard error body. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

const CORRELATION_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Fastify `genReqId`: reuse a well-formed inbound `x-request-id`, otherwise mint a UUID. */
export function generateCorrelationId(req: { headers: Record<string, unknown> }): string {
  const inbound = req.headers['x-request-id'];
  return typeof inbound === 'string' && CORRELATION_ID.test(inbound) ? inbound : randomUUID();
}

export function errorBody(
  code: ErrorCode,
  message: string,
  correlationId: string,
  details?: Record<string, unknown>,
): ErrorBody {
  return details === undefined
    ? { code, message, correlationId }
    : { code, message, details, correlationId };
}

function fromFastifyStatus(status: number): ErrorCode {
  if (status === 404) return 'not_found';
  if (status === 413) return 'payload_too_large';
  if (status === 429) return 'rate_limited';
  return 'validation_failed'; // malformed JSON, unsupported media type, bad headers...
}

/** Zod issues reduced to path + code + message; never the offending input values. */
function zodDetails(err: ZodError): Record<string, unknown> {
  return {
    issues: err.issues.map((i) => ({ path: i.path.map(String), code: i.code, message: i.message })),
  };
}

export function toErrorBody(
  err: unknown,
  correlationId: string,
): { status: number; body: ErrorBody } {
  if (err instanceof AppError) {
    return {
      status: ERROR_STATUS[err.code],
      body: errorBody(err.code, err.message, correlationId, err.details),
    };
  }
  if (err instanceof ZodError) {
    return {
      status: ERROR_STATUS.validation_failed,
      body: errorBody(
        'validation_failed',
        'request validation failed',
        correlationId,
        zodDetails(err),
      ),
    };
  }
  const status = (err as Partial<FastifyError> | null)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const code = fromFastifyStatus(status);
    return {
      status: ERROR_STATUS[code],
      body: errorBody(code, 'request rejected', correlationId),
    };
  }
  // Unknown failure (including pg errors): fixed message, nothing from the error reaches the client.
  return {
    status: ERROR_STATUS.internal_error,
    body: errorBody('internal_error', 'internal error', correlationId),
  };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const { status, body } = toErrorBody(err, request.id);
    if (status >= 500) request.log.error({ err }, 'request failed');
    else request.log.info({ errorCode: body.code }, 'request rejected');
    return reply.code(status).send(body);
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(ERROR_STATUS.not_found).send(errorBody('not_found', 'not found', request.id)),
  );
}

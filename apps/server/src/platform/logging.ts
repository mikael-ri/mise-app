/**
 * Structured JSON logging (pino via Fastify) with redaction (hard rule 9, tech §13).
 * Request/response bodies are never logged. Query strings are stripped from logged URLs because
 * OIDC callbacks carry `code` and `state` there.
 */
// Field names redacted at the top level and one level down (pino wildcards match one segment).
// Limit: deeper nesting is NOT redacted, so do not log nested objects that may hold such data.
// OIDC `code` is never logged: query strings are stripped and no handler logs it.
const SENSITIVE_FIELDS = [
  'authorization',
  'cookie',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'secret',
  'csrfSecret',
  'databaseUrl',
  'apiKey',
  'state',
  'messages',
  'chat',
  'prompt',
  'content',
  'image',
  'profile',
  'displayName',
  'email',
  'body',
];

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_FIELDS,
  ...SENSITIVE_FIELDS.map((f) => `*.${f}`),
];

interface LoggedError {
  name?: string;
  code?: unknown;
  constraint?: unknown;
  stack?: string;
}

// Keep only non-sensitive fields: pg errors carry `detail`, `where`, `parameters` with row values.
// The message is dropped too (drivers may echo values in it); the stack is truncated.
export function serializeError(err: LoggedError): {
  [key: string]: unknown;
  type: string;
  message: string;
  stack: string;
} {
  return {
    type: err.name ?? 'Error',
    message: '[omitted]',
    ...(typeof err.code === 'string' ? { code: err.code } : {}),
    ...(typeof err.constraint === 'string' ? { constraint: err.constraint } : {}),
    stack: (err.stack ?? '').split('\n').slice(1, 7).join('\n'), // first line is the message
  };
}

interface LoggedRequest {
  method?: string;
  url?: string;
  id?: string;
}

export function buildLoggerOptions(level: string) {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: {
      err: serializeError,
      req: (req: LoggedRequest) => ({
        method: req.method ?? '',
        url: (req.url ?? '').split('?')[0] ?? '',
      }),
    },
  };
}

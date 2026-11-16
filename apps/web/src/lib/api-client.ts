import { ErrorBody } from '@mise/contracts';
import type { ErrorCode } from '@mise/contracts';
import type { z } from 'zod';

export const CSRF_HEADER = 'X-CSRF-Token';

export type ApiErrorCode = ErrorCode | 'network_error' | 'unexpected_response';

/** Error from the API (parsed error body) or from the transport. Never carries a stack for the UI. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly correlationId: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(init: {
    status: number;
    code: ApiErrorCode;
    message: string;
    correlationId?: string | undefined;
    details?: Record<string, unknown> | undefined;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.correlationId = init.correlationId;
    this.details = init.details;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export interface ApiClientOptions {
  /** Current session CSRF token (from `MeResponse.csrfToken`), if signed in. */
  getCsrfToken: () => string | undefined;
  /** Called once per 401 response, before the error is thrown. */
  onSessionEnded: () => void;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions<S extends z.ZodType | undefined> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Absolute path starting with `/api/`. Same-origin only. */
  path: string;
  body?: unknown;
  /** Response schema; omit for 204 responses. */
  schema?: S;
}

export interface ApiClient {
  request<S extends z.ZodType | undefined = undefined>(
    options: RequestOptions<S>,
  ): Promise<S extends z.ZodType ? z.output<S> : undefined>;
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const parsed = ErrorBody.safeParse(await response.json());
    if (parsed.success) {
      return new ApiError({
        status: response.status,
        code: parsed.data.code,
        message: parsed.data.message,
        correlationId: parsed.data.correlationId,
        details: parsed.data.details,
      });
    }
  } catch {
    // body was not JSON; fall through
  }
  return new ApiError({
    status: response.status,
    code: 'unexpected_response',
    message: `unexpected response ${response.status}`,
    correlationId: response.headers.get('x-request-id') ?? undefined,
  });
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  return {
    async request<S extends z.ZodType | undefined = undefined>({
      method = 'GET',
      path,
      body,
      schema,
    }: RequestOptions<S>) {
      if (!path.startsWith('/api/')) throw new Error('api-client: same-origin /api/ paths only');
      const headers: Record<string, string> = { accept: 'application/json' };
      if (method !== 'GET') {
        const csrf = options.getCsrfToken();
        if (csrf !== undefined) headers[CSRF_HEADER] = csrf;
      }
      if (body !== undefined) headers['content-type'] = 'application/json';

      let response: Response;
      try {
        response = await doFetch(path, {
          method,
          headers,
          credentials: 'same-origin',
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        throw new ApiError({ status: 0, code: 'network_error', message: 'network error' });
      }

      if (!response.ok) {
        const error = await toApiError(response);
        if (error.isUnauthenticated) options.onSessionEnded();
        throw error;
      }
      if (schema === undefined) return undefined as never;
      const parsed = schema.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success) {
        throw new ApiError({
          status: response.status,
          code: 'unexpected_response',
          message: 'response did not match the contract',
          correlationId: response.headers.get('x-request-id') ?? undefined,
        });
      }
      return parsed.data as never;
    },
  };
}

import { z } from 'zod';
import { ERROR_STATUS } from './errors.js';
import {
  HEADER_ETAG,
  HEADER_IDEMPOTENCY_KEY,
  HEADER_IF_MATCH,
  IdempotencyKeyHeader,
  IfMatchHeader,
} from './headers.js';
import { API_PREFIX, ROUTES, type RouteDef } from './routes.js';

// Builds the OpenAPI 3.1 document from ROUTES and the schemas registered with `.meta({ id })`.
// Uses Zod's built-in JSON Schema output (draft 2020-12, which OpenAPI 3.1 uses); no extra dependency.

type Json = Record<string, unknown>;

const ref = (id: string): Json => ({ $ref: `#/components/schemas/${id}` });

const stripDialect = (schema: Json): Json => {
  const rest = { ...schema };
  delete rest['$schema'];
  return rest;
};

const registeredId = (schema: z.ZodType): string | undefined => {
  const meta = z.globalRegistry.get(schema);
  return typeof meta?.id === 'string' ? meta.id : undefined;
};

const toSchema = (schema: z.ZodType, io: 'input' | 'output'): Json => {
  const id = registeredId(schema);
  if (id) return ref(id);
  return stripDialect(
    // Only params/query reach here; they contain no registered schemas, so no $defs are emitted.
    z.toJSONSchema(schema, { io }) as Json,
  );
};

const errorResponse = (codes: string[]): Json => ({
  description: `Error: ${codes.join(', ')}`,
  content: { 'application/json': { schema: ref('ErrorBody') } },
});

const parameters = (route: RouteDef): Json[] => {
  const out: Json[] = [];
  const add = (location: 'path' | 'query', schema: z.ZodType | undefined) => {
    if (!schema) return;
    const json = toSchema(schema, 'input');
    const props = (json['properties'] ?? {}) as Record<string, Json>;
    const required = new Set((json['required'] as string[] | undefined) ?? []);
    for (const [name, prop] of Object.entries(props)) {
      out.push({
        name,
        in: location,
        required: location === 'path' || required.has(name),
        schema: prop,
      });
    }
  };
  add('path', route.params);
  add('query', route.query);
  if (route.ifMatch) {
    out.push({
      name: 'If-Match',
      in: 'header',
      required: route.ifMatch === 'required',
      description:
        route.ifMatch === 'required'
          ? 'Strong ETag "<revision>" from the last read. Stale -> 409 stale_revision; missing -> 428.'
          : 'Required for detail edits (missing -> 428, stale -> 409 stale_revision); ignored for a {picked} checkoff.',
      schema: toSchema(IfMatchHeader, 'input'),
    });
  }
  if (route.idempotencyKey) {
    out.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      description:
        'Client-generated key, scoped to household + member + operation. Same key and payload replays the first outcome; different payload -> 422.',
      schema: toSchema(IdempotencyKeyHeader, 'input'),
    });
  }
  return out;
};

const errorResponses = (route: RouteDef): Record<string, Json> => {
  const byStatus = new Map<number, string[]>();
  const add = (code: keyof typeof ERROR_STATUS) => {
    const status = ERROR_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  };
  if (route.params || route.query || route.body) add('validation_failed');
  if (route.idempotencyKey) add('idempotency_key_required');
  if (route.auth) add('unauthenticated');
  if (route.params) add('not_found');
  if (route.ifMatch) add('stale_revision');
  if (route.body) add('payload_too_large');
  if (route.idempotencyKey) add('idempotency_key_reused');
  if (route.ifMatch) add('precondition_required');
  add('rate_limited');
  add('internal_error');
  return Object.fromEntries(
    [...byStatus].map(([status, codes]) => [String(status), errorResponse(codes)]),
  );
};

const operation = (route: RouteDef): Json => {
  const responses: Record<string, Json> = {};
  for (const [status, res] of Object.entries(route.responses)) {
    const entry: Json = { description: res.description };
    if (res.schema) {
      const mediaType = res.eventStream ? 'text/event-stream' : 'application/json';
      entry['content'] = { [mediaType]: { schema: toSchema(res.schema, 'output') } };
    }
    const headers: Json = {};
    if (res.etag)
      headers[HEADER_ETAG.toUpperCase()] = {
        schema: { type: 'string' },
        description: '"<revision>"',
      };
    if (res.redirect) headers['Location'] = { schema: { type: 'string' } };
    if (Object.keys(headers).length > 0) entry['headers'] = headers;
    responses[status] = entry;
  }
  Object.assign(responses, errorResponses(route));

  const op: Json = {
    operationId: route.operationId,
    tags: [route.tag],
    summary: route.summary,
    security: route.auth ? [{ sessionCookie: [] }] : [],
  };
  const params = parameters(route);
  if (params.length > 0) op['parameters'] = params;
  if (route.body) {
    op['requestBody'] = {
      required: true,
      content: { 'application/json': { schema: toSchema(route.body, 'input') } },
    };
  }
  op['responses'] = responses;
  return op;
};

export const buildOpenApiDocument = (): Json => {
  const components = z.toJSONSchema(z.globalRegistry, {
    io: 'output',
    uri: (id) => `#/components/schemas/${id}`,
  }) as { schemas: Record<string, Json> };
  const schemas = Object.fromEntries(
    Object.entries(components.schemas)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, schema]) => [id, stripDialect(schema)]),
  );

  const paths: Record<string, Record<string, Json>> = {};
  for (const route of ROUTES) {
    const path = `${API_PREFIX}${route.path}`;
    paths[path] = { ...(paths[path] ?? {}), [route.method]: operation(route) };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Mise API',
      version: '0.1.0',
      description: `Generated from packages/contracts. Do not edit; run \`pnpm --filter @mise/contracts openapi:generate\`. Header names: ${HEADER_IF_MATCH}, ${HEADER_IDEMPOTENCY_KEY}.`,
    },
    paths,
    components: {
      schemas,
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'mise_session',
          description:
            'Opaque per-device session token (ADR-003). Cookie name is finalised in A07.',
        },
      },
    },
  };
};

export const renderOpenApiDocument = (): string =>
  `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;

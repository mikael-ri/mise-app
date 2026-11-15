// Calls to Authelia: discovery, JWKS and the token endpoint. Always over the internal URL with the
// public host in X-Forwarded-* (ADR-012 addendum); `iss` is still validated against the public issuer.
import { z } from 'zod';
import type { OidcConfig } from '../platform/index.js';
import { Jwks, OidcError } from './oidc.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;
/** Minimum gap between JWKS refetches triggered by an unknown kid (key rotation). */
const JWKS_REFETCH_MS = 60_000;
/** Keys are refetched at least this often, so a key Authelia removed stops being trusted. */
const JWKS_TTL_MS = 3_600_000;

const Discovery = z.looseObject({
  issuer: z.string(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
  authorization_response_iss_parameter_supported: z.boolean().optional(),
});

const TokenResponse = z.looseObject({ id_token: z.string().min(1).max(16_384) });

export interface IdpEndpoints {
  /** Public URL the browser is sent to. */
  authorizationEndpoint: string;
  /** Internal URLs the server calls. */
  tokenEndpoint: string;
  jwksUri: string;
  /** RFC 9207: the callback must then carry `iss`. */
  issParameterRequired: boolean;
}

export interface IdpClient {
  endpoints(): Promise<IdpEndpoints>;
  /** `forceRefresh` refetches (rate-limited) when the token names an unknown key. */
  jwks(forceRefresh?: boolean): Promise<Jwks>;
  /** Exchanges the code (client_secret_basic, PKCE verifier) and returns the raw ID token. */
  exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<string>;
}

/** Maps a public issuer URL onto the internal base; refuses anything outside the issuer. */
function toInternal(publicUrl: string, oidc: OidcConfig): string {
  if (publicUrl !== oidc.issuer && !publicUrl.startsWith(`${oidc.issuer}/`)) {
    throw new OidcError('discovery_failed');
  }
  return oidc.internalUrl + publicUrl.slice(oidc.issuer.length);
}

export function createIdpClient(
  oidc: OidcConfig,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): IdpClient {
  const issuerUrl = new URL(oidc.issuer);
  const forwarded = {
    'x-forwarded-proto': issuerUrl.protocol.replace(':', ''),
    'x-forwarded-host': issuerUrl.host,
  };
  let endpoints: Promise<IdpEndpoints> | null = null;
  let jwksCache: { value: Jwks; fetchedAt: number } | null = null;

  async function call(url: string, init: RequestInit, failure: OidcError['reason']) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json', ...forwarded, ...init.headers },
      });
    } catch {
      throw new OidcError(failure);
    }
    if (!res.ok) throw new OidcError(failure);
    try {
      return (await res.json()) as unknown;
    } catch {
      throw new OidcError(failure);
    }
  }

  async function discover(): Promise<IdpEndpoints> {
    const raw = await call(
      `${oidc.internalUrl}/.well-known/openid-configuration`,
      { method: 'GET' },
      'discovery_failed',
    );
    const d = Discovery.safeParse(raw);
    if (!d.success || d.data.issuer !== oidc.issuer) throw new OidcError('discovery_failed');
    if (!d.data.authorization_endpoint.startsWith(`${oidc.issuer}/`)) {
      throw new OidcError('discovery_failed');
    }
    return {
      authorizationEndpoint: d.data.authorization_endpoint,
      tokenEndpoint: toInternal(d.data.token_endpoint, oidc),
      jwksUri: toInternal(d.data.jwks_uri, oidc),
      issParameterRequired: d.data.authorization_response_iss_parameter_supported === true,
    };
  }

  const client: IdpClient = {
    endpoints() {
      // A failed discovery is not cached, so the next login retries.
      endpoints ??= discover().catch((err: unknown) => {
        endpoints = null;
        throw err;
      });
      return endpoints;
    },

    async jwks(forceRefresh = false) {
      const t = now();
      const fresh = jwksCache !== null && !forceRefresh && t - jwksCache.fetchedAt < JWKS_TTL_MS;
      const throttled = jwksCache !== null && t - jwksCache.fetchedAt < JWKS_REFETCH_MS;
      if (jwksCache !== null && (fresh || throttled)) return jwksCache.value;
      const { jwksUri } = await client.endpoints();
      const parsed = Jwks.safeParse(await call(jwksUri, { method: 'GET' }, 'jwks_failed'));
      if (!parsed.success) throw new OidcError('jwks_failed');
      jwksCache = { value: parsed.data, fetchedAt: t };
      return parsed.data;
    },

    async exchangeCode(code, codeVerifier, redirectUri) {
      const { tokenEndpoint } = await client.endpoints();
      // RFC 6749 §2.3.1: form-urlencode id and secret before Basic encoding.
      const basic = Buffer.from(
        `${encodeURIComponent(oidc.clientId)}:${encodeURIComponent(oidc.clientSecret)}`,
      ).toString('base64');
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }).toString();
      const raw = await call(
        tokenEndpoint,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${basic}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body,
        },
        'token_exchange_failed',
      );
      const parsed = TokenResponse.safeParse(raw);
      if (!parsed.success) throw new OidcError('token_exchange_failed');
      return parsed.data.id_token;
    },
  };
  return client;
}

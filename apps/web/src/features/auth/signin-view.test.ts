import { describe, expect, it } from 'vitest';
import { resolveSignInView } from './signin-view.js';

const view = (query: string) => resolveSignInView(new URLSearchParams(query));

describe('sign-in view (FR-30, AC-11)', () => {
  it.each([
    ['', 'default', null, true],
    ['reason=session_ended', 'session_ended', 'auth.signin.message.sessionEnded', true],
    ['reason=signed_out', 'signed_out', 'auth.signin.message.signedOut', true],
    ['error=not_provisioned', 'not_provisioned', 'auth.signin.message.notProvisioned', false],
    ['error=signin_failed', 'failed', 'auth.signin.message.failed', true],
    ['error=unexpected', 'unexpected', 'auth.signin.message.unexpected', true],
    ['error=whatever', 'default', null, true],
    ['reason=whatever', 'default', null, true],
    ['error=whatever&reason=signed_out', 'signed_out', 'auth.signin.message.signedOut', true],
  ])('maps "%s"', (query, variant, message, showSignIn) => {
    expect(view(query)).toMatchObject({ variant, message, showSignIn });
  });

  it('passes only valid same-origin returnTo to the OIDC start URL', () => {
    expect(view('returnTo=%2Fsettings%2Fdevices').signInHref).toBe(
      '/api/v1/auth/oidc/start?returnTo=%2Fsettings%2Fdevices',
    );
    for (const bad of ['//evil.example', 'https://evil.example', '/signin', '/\\evil']) {
      expect(view(`returnTo=${encodeURIComponent(bad)}`).signInHref).toBe(
        '/api/v1/auth/oidc/start',
      );
    }
  });

  it('shows a correlationId only for the unexpected variant and only if well formed', () => {
    expect(view('error=unexpected&correlationId=abc-123').correlationId).toBe('abc-123');
    expect(view('error=signin_failed&correlationId=abc').correlationId).toBeUndefined();
    expect(view('error=unexpected&correlationId=%3Cb%3E').correlationId).toBeUndefined();
  });

  it('truncates a long correlationId to 64 chars and omits ones with other characters', () => {
    const long = 'a'.repeat(200);
    expect(view(`error=unexpected&correlationId=${long}`).correlationId).toBe('a'.repeat(64));
    for (const bad of ['<img src=x onerror=alert(1)>', 'a.b', 'a b', 'x'.repeat(10) + '%3Cb%3E']) {
      expect(
        view(`error=unexpected&correlationId=${encodeURIComponent(bad)}`).correlationId,
      ).toBeUndefined();
    }
  });
});

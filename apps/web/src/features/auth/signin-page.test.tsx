import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe.js';
import { fakeApi, renderApp, unauthenticated } from '../../test/render-app.js';

const signedOut = () => fakeApi({ me: async () => Promise.reject(unauthenticated()) });

describe('sign-in page (FR-30, AC-11)', () => {
  it('default: tagline, sign-in link to the OIDC start, security note, no axe violations', async () => {
    const { container } = renderApp('/signin', signedOut());
    const link = await screen.findByRole('link', { name: 'Sign in' });
    expect(link).toHaveAttribute('href', '/api/v1/auth/oidc/start');
    expect(screen.getByText(/confirm your identity each time/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('session ended variant (401 / revoked)', async () => {
    renderApp('/signin?reason=session_ended', signedOut());
    expect(await screen.findByText('Your session has ended. Sign in again.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signed out variant', async () => {
    renderApp('/signin?reason=signed_out', signedOut());
    expect(await screen.findByText('You have signed out.')).toBeInTheDocument();
  });

  it('not provisioned variant shows no sign-in button (no retry loop)', async () => {
    renderApp('/signin?error=not_provisioned', signedOut());
    expect(
      await screen.findByText(
        "This account isn't set up for Mise. Ask the household administrator.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('sign-in failed variant, reached via /login?error=signin_failed', async () => {
    renderApp('/login?error=signin_failed', signedOut());
    expect(await screen.findByText("Sign-in didn't complete. Try again.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('unexpected variant shows the correlationId', async () => {
    renderApp('/signin?error=unexpected&correlationId=req-42', signedOut());
    expect(await screen.findByText('Reference: req-42')).toBeInTheDocument();
  });

  it('ignores unknown error and reason values (default landing)', async () => {
    renderApp('/signin?error=bogus&reason=bogus', signedOut());
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders a crafted correlationId safely: markup omitted, long value truncated', async () => {
    const markup = encodeURIComponent('<img src=x onerror=alert(1)>');
    const first = renderApp(`/signin?error=unexpected&correlationId=${markup}`, signedOut());
    await screen.findByText('Something went wrong while signing in.');
    expect(screen.queryByText(/Reference/)).not.toBeInTheDocument();
    expect(first.container.querySelector('img')).toBeNull();
    first.unmount();
    renderApp(`/signin?error=unexpected&correlationId=${'a'.repeat(200)}`, signedOut());
    expect(await screen.findByText(`Reference: ${'a'.repeat(64)}`)).toBeInTheDocument();
  });

  it('forwards a valid returnTo to the OIDC start URL', async () => {
    renderApp('/signin?returnTo=%2Fsettings%2Fdevices', signedOut());
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/api/v1/auth/oidc/start?returnTo=%2Fsettings%2Fdevices',
    );
  });
});

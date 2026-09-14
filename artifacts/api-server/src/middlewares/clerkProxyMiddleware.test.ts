import { afterEach, describe, expect, it } from 'vitest';
import { getClerkProxyHost } from './clerkProxyMiddleware';

const ORIGINAL_ENV = {
  REPLIT_DOMAINS: process.env.REPLIT_DOMAINS,
  APP_HOST: process.env.APP_HOST,
  CUSTOM_DOMAIN: process.env.CUSTOM_DOMAIN,
};

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('getClerkProxyHost', () => {
  it('accepts a forwarded host only when server configuration allows it', () => {
    process.env.REPLIT_DOMAINS = 'watchtime.replit.app,shows.example.com';

    expect(
      getClerkProxyHost({
        headers: {
          host: 'watchtime.replit.app',
          'x-forwarded-host': 'shows.example.com',
        },
      }),
    ).toBe('shows.example.com');
  });

  it('falls back to an allowlisted Host header when x-forwarded-host is spoofed', () => {
    process.env.REPLIT_DOMAINS = 'watchtime.replit.app';

    expect(
      getClerkProxyHost({
        headers: {
          host: 'watchtime.replit.app',
          'x-forwarded-host': 'attacker.example',
        },
      }),
    ).toBe('watchtime.replit.app');
  });

  it('rejects the request when neither supplied host is allowlisted', () => {
    process.env.REPLIT_DOMAINS = 'watchtime.replit.app';

    expect(
      getClerkProxyHost({
        headers: {
          host: 'other.example',
          'x-forwarded-host': 'attacker.example',
        },
      }),
    ).toBeUndefined();
  });

  it('normalizes case and ports while preserving the allowlisted authority', () => {
    process.env.APP_HOST = 'WatchTime.Example:8443';

    expect(
      getClerkProxyHost({
        headers: { 'x-forwarded-host': 'WATCHTIME.EXAMPLE:8443' },
      }),
    ).toBe('watchtime.example:8443');
  });

  it('checks only the first forwarded hop and rejects malformed hosts', () => {
    process.env.CUSTOM_DOMAIN = 'shows.example.com';

    expect(
      getClerkProxyHost({
        headers: {
          host: 'shows.example.com',
          'x-forwarded-host': 'attacker.example, shows.example.com',
        },
      }),
    ).toBe('shows.example.com');
    expect(
      getClerkProxyHost({
        headers: { 'x-forwarded-host': 'shows.example.com/path' },
      }),
    ).toBeUndefined();
  });
});
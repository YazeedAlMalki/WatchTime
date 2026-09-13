import { isDevelopmentAuthEnabled } from '@workspace/dev-auth';

describe('authentication environment boundary', () => {
  it('enables the shared demo contract only for development builds', () => {
    expect(isDevelopmentAuthEnabled('development')).toBe(true);
    expect(isDevelopmentAuthEnabled('production')).toBe(false);
  });
});
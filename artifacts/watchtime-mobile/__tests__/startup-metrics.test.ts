const mockReport = jest.fn();
jest.mock('@workspace/api-client-react', () => ({
  reportStartupDiagnostic: (...args: unknown[]) => mockReport(...args),
}));

import { markStartup, reportStartupFailure } from '../lib/startup-metrics';

describe('startup failure reporting', () => {
  const originalDomain = process.env.EXPO_PUBLIC_DOMAIN;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_DOMAIN = 'watchtime.example';
    mockReport.mockReset();
  });

  afterAll(() => {
    if (originalDomain === undefined) delete process.env.EXPO_PUBLIC_DOMAIN;
    else process.env.EXPO_PUBLIC_DOMAIN = originalDomain;
  });

  it('sends only the fixed failure code, without an error message', async () => {
    mockReport.mockResolvedValue(undefined);
    reportStartupFailure('splash-hide-timeout');
    expect(mockReport).toHaveBeenCalledWith({ event: 'splash-hide-timeout' });
    await Promise.resolve();
  });

  it('reports in release builds while keeping development-only checkpoints quiet', async () => {
    const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
    const wasDev = runtime.__DEV__;
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      runtime.__DEV__ = false;
      mockReport.mockResolvedValue(undefined);
      markStartup('fonts-ready');
      reportStartupFailure('font-error');
      expect(info).not.toHaveBeenCalled();
      expect(mockReport).toHaveBeenCalledWith({ event: 'font-error' });
      await Promise.resolve();
    } finally {
      runtime.__DEV__ = wasDev;
      info.mockRestore();
    }
  });

  it('swallows rejected and synchronous transport failures', async () => {
    mockReport.mockRejectedValueOnce(new Error('network unavailable'));
    expect(() => reportStartupFailure('font-error')).not.toThrow();
    await Promise.resolve();
    mockReport.mockImplementationOnce(() => { throw new Error('transport unavailable'); });
    expect(() => reportStartupFailure('splash-prevent-error')).not.toThrow();
  });

  it('retains development console checkpoints', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    markStartup('fonts-ready');
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/\[WatchTime startup\] fonts-ready: \d+ms/));
    info.mockRestore();
  });
});
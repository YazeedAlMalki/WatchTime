import test from 'node:test';
import assert from 'node:assert/strict';
import { assessScreen, classifyDevice, requiredProbes, validateConfig } from './evidence.mjs';

const expected = { titleId: 12, logicalWidth: 375, fontScale: 1.3, fontState: 'loaded' };
const config = {
  serverUrl: 'http://127.0.0.1:4723', appId: 'com.watchtime.mobile',
  capabilities: { platformName: 'iOS' },
  browseUrl: 'watchtime-mobile:///browse', titleUrl: 'watchtime-mobile:///title/12', expected,
};
const metadata = (screen) => ({
  version: 1, screen, platform: 'ios', contentReady: true, titleId: 12,
  logicalWidth: 375, fontScale: 1.3,
  fonts: Object.fromEntries(['regular', 'medium', 'semibold', 'bold'].map((f) => [f, 'loaded'])),
  measurements: Object.fromEntries(requiredProbes[screen].map((id) => [
    id, { width: 100, height: 40, lines: [{ x: 0, y: 0, width: 98, height: 20 }, { x: 0, y: 20, width: 90, height: 20 }] },
  ])),
});
const passes = (screen, data) => assessScreen(screen, data, expected, 'ios').every((o) => o.status === 'pass');

test('physical evidence requires device-derived proof; browser cannot count', () => {
  assert.equal(classifyDevice('ios', { isSimulator: 0 }), 'physical');
  assert.equal(classifyDevice('ios', { isSimulator: false }), 'physical');
  assert.equal(classifyDevice('ios', { isSimulator: 1 }), 'simulator');
  assert.equal(classifyDevice('ios', { model: 'Physical iPhone' }), 'unverified-native');
  assert.equal(classifyDevice('android', {}, true), 'physical');
  assert.equal(classifyDevice('android', { model: 'Pixel' }), 'unverified-native');
  assert.equal(classifyDevice('ios', { isSimulator: 0 }, false, 'Safari'), 'browser');
});

test('only local credential-free opt-in endpoints and native links are accepted', () => {
  assert.equal(validateConfig(config), 'ios');
  for (const serverUrl of ['https://cloud.example.com', 'http://user:secret@localhost:4723', 'http://localhost:4723?token=abc', 'file:///tmp/a']) {
    assert.throws(() => validateConfig({ ...config, serverUrl }));
  }
  assert.throws(() => validateConfig({ ...config, browseUrl: 'https://localhost/browse' }));
  assert.throws(() => validateConfig({ ...config, titleUrl: 'watchtime-mobile:///title/99' }));
  assert.throws(() => validateConfig({ ...config, expected: {} }));
  assert.throws(() => validateConfig({ ...config, capabilities: { platformName: 'iOS', browserName: 'Safari' } }));
});

for (const screen of ['browse', 'title']) {
  test(`${screen}: wrapped native text fits; width/height clipping fail`, () => {
    assert.equal(passes(screen, metadata(screen)), true);
    for (const dimension of ['width', 'height']) {
      const data = metadata(screen);
      data.measurements[requiredProbes[screen][0]][dimension] = 10;
      assert.equal(passes(screen, data), false);
    }
  });
  test(`${screen}: missing measurements, content, mismatched font/width/scale fail`, () => {
    for (const change of [
      (data) => { delete data.measurements[requiredProbes[screen][0]]; },
      (data) => { data.contentReady = false; },
      (data) => { data.fonts.regular = 'loading'; },
      (data) => { data.fonts.regular = 'fallback'; },
      (data) => { data.logicalWidth = 430; },
      (data) => { data.fontScale = 1; },
      (data) => { data.platform = 'web'; },
      (data) => { data.measurements[requiredProbes[screen][0]].lines[0].height = NaN; },
    ]) {
      const data = metadata(screen);
      change(data);
      assert.equal(passes(screen, data), false);
    }
  });
}
test('wrong title is not evidence; explicitly requested fallback is recorded separately', () => {
  const data = metadata('title');
  data.titleId = 99;
  assert.equal(passes('title', data), false);
  data.titleId = expected.titleId;
  data.fonts = Object.fromEntries(Object.keys(data.fonts).map((f) => [f, 'fallback']));
  assert.equal(assessScreen('title', data, { ...expected, fontState: 'fallback' }, 'ios').every((o) => o.status === 'pass'), true);
});

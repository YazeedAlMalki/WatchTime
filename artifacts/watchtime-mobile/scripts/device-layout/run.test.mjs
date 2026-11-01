// Fake WebDriver only. These tests do not produce real-device evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { run } from './run.mjs';
import { probesFor } from './evidence.mjs';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return result;
}

function pixelPng(red, green, blue) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from([0, red, green, blue, 255]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test('runner captures both screens, records simulator separately and always deletes session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'watchtime-synthetic-layout-'));
  let screen = 'browse';
  let titleNavigations = 0;
  let deleted = false;
  let isSimulator = true;
  let screenshotBase64 = pixelPng(20, 40, 60).toString('base64');
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const part of request) body += part;
    const data = body ? JSON.parse(body) : {};
    let value;
    if (request.url === '/session' && request.method === 'POST') {
      titleNavigations = 0;
      screen = 'browse';
      value = { sessionId: 'synthetic-session', capabilities: { platformVersion: '26.0' } };
    } else if (request.method === 'DELETE') {
      deleted = true;
      value = null;
    } else if (request.url.endsWith('/execute/sync')) {
      if (data.script === 'mobile: deviceInfo') value = { ProductType: 'Synthetic iPhone', isSimulator: isSimulator ? 1 : 0 };
      else {
        if (data.script === 'mobile: deepLink') {
          const url = data.args[0].url;
          if (url.includes('/title/')) {
            titleNavigations += 1;
            screen = titleNavigations > 1 ? 'safety' : 'title';
          } else if (url.includes('/my-shows')) screen = 'my-shows';
          else if (url.endsWith('/browse')) screen = 'browse';
          else screen = 'home';
        }
        value = null;
      }
    } else if (request.url.endsWith('/element')) {
      value = { 'element-6066-11e4-a52e-4f735466cecf': 'element-id' };
    } else if (request.url.includes('/attribute/')) {
      value = JSON.stringify({
        version: 1, screen, contentReady: true, platform: 'ios', osVersion: '26.0', accountState: 'guest',
        titleId: 12, titleType: 'movie', logicalWidth: 375, logicalHeight: 812, fontScale: 1, pixelRatio: 3,
        fonts: { regular: 'loaded', medium: 'loaded', semibold: 'loaded', bold: 'loaded' },
        measurements: Object.fromEntries(probesFor(screen, config.expected).map((id) => [
          id, { width: 100, height: 20, lines: [{ x: 0, y: 0, width: 90, height: 20 }] },
        ])),
      });
    } else if (request.url.endsWith('/screenshot')) {
      value = screenshotBase64;
    } else {
      response.writeHead(404);
      response.end(JSON.stringify({ value: { error: 'unknown command' } }));
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ value }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const config = {
    serverUrl: `http://127.0.0.1:${server.address().port}`, appId: 'host.exp.Exponent',
    capabilities: { platformName: 'iOS' },
    browseUrl: 'exp://localhost/--/browse', titleUrl: 'exp://localhost/--/title/12',
    homeUrl: 'exp://localhost/--/', myShowsUrl: 'exp://localhost/--/my-shows',
    safetyUrl: 'exp://localhost/--/title/12',
    expected: { titleId: 12, logicalWidth: 375, fontScale: 1, fontState: 'loaded', accountState: 'guest' },
  };
  try {
    const report = await run(config, { outputRoot: directory });
    assert.equal(report.status, 'fail', 'A simulator is not a successful physical run');
    assert.equal(report.physicalEvidence, false);
    assert.equal(report.device.classification, 'simulator');
    assert.equal(report.screens.length, 5);
    assert.ok(report.screens.every((s) => s.status === 'pass'));
    for (const screen of ['home', 'my-shows', 'safety']) {
      const result = report.screens.find((entry) => entry.screen === screen);
      assert.ok(result.observations.some((item) => item.name === `${screen} content ready`));
      assert.ok(result.observations.some((item) => item.name.startsWith(`${screen}-`) && item.status === 'pass'));
    }
    assert.equal(report.visualReview, 'required');
    assert.equal(report.baseline.status, 'not-compared');
    assert.equal(report.nativeAcceptance, 'not-performed');
    assert.equal(deleted, true);
    const [timestamp] = await readdir(join(directory, 'simulator/ios'));
    const files = await readdir(join(directory, 'simulator/ios', timestamp));
    assert.deepEqual(files.sort(), [
      'browse.png', 'home.png', 'my-shows.png', 'report.json', 'safety.png', 'title-top.png', 'title.png',
    ]);
    assert.ok(!(await readFile(join(directory, 'simulator/ios', timestamp, 'report.json'), 'utf8')).includes('synthetic-session'));
    const diagnostic = await run(config, { outputRoot: directory, diagnostic: true });
    assert.equal(diagnostic.status, 'pass');
    assert.equal(diagnostic.physicalEvidence, false);
    isSimulator = false;
    const approved = await run(config, { outputRoot: directory, approveBaseline: true });
    assert.equal(approved.status, 'pass');
    assert.equal(approved.physicalEvidence, true);
    assert.equal(approved.baseline.status, 'approved');
    assert.equal(approved.visualReview, 'required');
    const unchanged = await run(config, { outputRoot: directory });
    assert.equal(unchanged.baseline.status, 'matched');
    assert.equal(unchanged.imageComparisons.length, 6);
    assert.ok(unchanged.imageComparisons.every(({ status }) => status === 'unchanged'));
    screenshotBase64 = pixelPng(220, 40, 60).toString('base64');
    const changed = await run(config, { outputRoot: directory });
    assert.equal(changed.imageComparisons.length, 6);
    assert.ok(changed.imageComparisons.every((comparison) =>
      comparison.status === 'changed' && comparison.diffScreenshot));
    const physicalRuns = await readdir(join(directory, 'physical/ios'));
    const latestRun = physicalRuns.sort().at(-1);
    const diffFiles = await readdir(join(directory, 'physical/ios', latestRun));
    assert.ok(diffFiles.includes('browse-diff.png'));
    assert.ok(diffFiles.includes('title-top-diff.png'));
    assert.ok(diffFiles.includes('title-diff.png'));
    assert.ok(diffFiles.includes('home-diff.png'));
    assert.ok(diffFiles.includes('my-shows-diff.png'));
    assert.ok(diffFiles.includes('safety-diff.png'));
    // Failure after session creation must still delete and save a blocked report.
    deleted = false;
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      const value = req.url === '/session'
        ? { sessionId: 'synthetic-session', capabilities: {} }
        : { error: 'unknown command', message: 'PRIVATE DRIVER DATA' };
      if (req.method === 'DELETE') deleted = true;
      res.end(JSON.stringify({ value }));
    });
    const blocked = await run(config, { outputRoot: directory });
    assert.equal(blocked.status, 'blocked');
    assert.equal(deleted, true);
    assert.equal(blocked.physicalEvidence, false);
    assert.ok(!JSON.stringify(blocked).includes('PRIVATE DRIVER DATA'));
  } finally {
    await new Promise((done) => server.close(done));
    await rm(directory, { recursive: true, force: true });
  }
});

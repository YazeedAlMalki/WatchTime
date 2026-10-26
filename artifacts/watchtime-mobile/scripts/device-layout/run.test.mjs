// Fake WebDriver only. These tests do not produce real-device evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './run.mjs';
import { requiredProbes } from './evidence.mjs';

test('runner captures both screens, records simulator separately and always deletes session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'watchtime-synthetic-layout-'));
  let screen = 'browse';
  let deleted = false;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const part of request) body += part;
    const data = body ? JSON.parse(body) : {};
    let value;
    if (request.url === '/session' && request.method === 'POST') {
      value = { sessionId: 'synthetic-session', capabilities: { platformVersion: '26.0' } };
    } else if (request.method === 'DELETE') {
      deleted = true;
      value = null;
    } else if (request.url.endsWith('/execute/sync')) {
      if (data.script === 'mobile: deviceInfo') value = { model: 'Synthetic iPhone', isSimulator: 1 };
      else {
        if (data.script === 'mobile: deepLink') screen = data.args[0].url.includes('title') ? 'title' : 'browse';
        value = null;
      }
    } else if (request.url.endsWith('/element')) {
      value = { 'element-6066-11e4-a52e-4f735466cecf': 'element-id' };
    } else if (request.url.includes('/attribute/')) {
      value = JSON.stringify({
        version: 1, screen, contentReady: true, platform: 'ios', osVersion: '26.0',
        titleId: 12, logicalWidth: 375, logicalHeight: 812, fontScale: 1, pixelRatio: 3,
        fonts: { regular: 'loaded', medium: 'loaded', semibold: 'loaded', bold: 'loaded' },
        measurements: Object.fromEntries(requiredProbes[screen].map((id) => [
          id, { width: 100, height: 20, lines: [{ x: 0, y: 0, width: 90, height: 20 }] },
        ])),
      });
    } else if (request.url.endsWith('/screenshot')) {
      value = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=';
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
    expected: { titleId: 12, logicalWidth: 375, fontScale: 1, fontState: 'loaded' },
  };
  try {
    const report = await run(config, { outputRoot: directory });
    assert.equal(report.status, 'fail', 'A simulator is not a successful physical run');
    assert.equal(report.physicalEvidence, false);
    assert.equal(report.device.classification, 'simulator');
    assert.equal(report.screens.length, 2);
    assert.ok(report.screens.every((s) => s.status === 'pass'));
    assert.equal(report.visualReview, 'required');
    assert.equal(report.nativeAcceptance, 'not-performed');
    assert.equal(deleted, true);
    const [timestamp] = await readdir(join(directory, 'simulator/ios'));
    const files = await readdir(join(directory, 'simulator/ios', timestamp));
    assert.deepEqual(files.sort(), ['browse.png', 'report.json', 'title-top.png', 'title.png']);
    assert.ok(!(await readFile(join(directory, 'simulator/ios', timestamp, 'report.json'), 'utf8')).includes('synthetic-session'));
    const diagnostic = await run(config, { outputRoot: directory, diagnostic: true });
    assert.equal(diagnostic.status, 'pass');
    assert.equal(diagnostic.physicalEvidence, false);
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

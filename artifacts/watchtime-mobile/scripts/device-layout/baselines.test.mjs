import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import {
  baselineKey, comparePngImages, makeBaselineIdentity, sameBaselineIdentity,
  screenshotStateMatches,
} from './baselines.mjs';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return result;
}

function pixelPng(red, green, blue, alpha = 255) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, red, green, blue, alpha]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const identity = (accountState = 'guest') => makeBaselineIdentity('ios', {
  model: 'iPhone17,1', osVersion: '26.0',
}, {
  platform: 'ios', logicalWidth: 393, fontScale: 1.2, accountState,
  fonts: { regular: 'loaded', medium: 'loaded', semibold: 'loaded', bold: 'loaded' },
});

test('baseline identity includes physical model, OS, width, font scale/state and account state', () => {
  const guest = identity();
  assert.ok(guest);
  assert.equal(sameBaselineIdentity(guest, identity()), true);
  assert.equal(sameBaselineIdentity(guest, identity('signed-in')), false);
  assert.equal(baselineKey(guest), baselineKey(identity()));
  assert.equal(identity('pending'), null);
  assert.equal(makeBaselineIdentity('ios', { model: 'iPhone17,1', osVersion: '26.0' }, {
    platform: 'web', logicalWidth: 393, fontScale: 1.2, accountState: 'guest',
    fonts: { regular: 'loaded', medium: 'loaded', semibold: 'loaded', bold: 'loaded' },
  }), null);
});

test('screenshot baselines require the same screen, title and guest/signed-in state', () => {
  const baseline = { file: 'title.png', screen: 'title', titleId: 12, accountState: 'guest' };
  assert.equal(screenshotStateMatches(baseline, 'title.png', {
    screen: 'title', titleId: 12, accountState: 'guest',
  }), true);
  assert.equal(screenshotStateMatches(baseline, 'browse.png', {
    screen: 'browse', accountState: 'guest',
  }), false);
  assert.equal(screenshotStateMatches(baseline, 'title.png', {
    screen: 'title', titleId: 13, accountState: 'guest',
  }), false);
  assert.equal(screenshotStateMatches(baseline, 'title.png', {
    screen: 'title', titleId: 12, accountState: 'signed-in',
  }), false);
});

test('PNG comparison ignores small channel noise and produces a visible changed-pixel mask', () => {
  const baseline = pixelPng(20, 40, 60);
  const tinyChange = pixelPng(30, 40, 60);
  assert.equal(comparePngImages(baseline, tinyChange).status, 'unchanged');

  const changed = comparePngImages(baseline, pixelPng(220, 40, 60));
  assert.equal(changed.status, 'changed');
  assert.equal(changed.changedPixels, 1);
  assert.equal(changed.changedPercent, 100);
  assert.ok(changed.diffPng.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')));
  assert.equal(comparePngImages(baseline, pixelPng(20, 40, 60, 0)).status, 'changed');
});

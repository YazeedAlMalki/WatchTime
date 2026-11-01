import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

const identityFields = [
  'platform', 'model', 'osVersion', 'logicalWidth', 'fontScale', 'fontState', 'accountState',
];

export function makeBaselineIdentity(platform, device, metadata) {
  if (metadata?.platform !== platform) return null;
  const fontStates = Object.values(metadata?.fonts ?? {});
  const fontState = fontStates.length === 4 && fontStates.every((state) => state === fontStates[0])
    ? fontStates[0]
    : null;
  const identity = {
    platform,
    model: device?.model,
    osVersion: device?.osVersion,
    logicalWidth: metadata?.logicalWidth,
    fontScale: metadata?.fontScale,
    fontState,
    accountState: metadata?.accountState,
  };
  if (!identityFields.every((field) => identity[field] !== undefined && identity[field] !== null) ||
      !['loaded', 'fallback'].includes(identity.fontState) ||
      !['guest', 'signed-in'].includes(identity.accountState)) return null;
  return identity;
}

export function baselineKey(identity) {
  return createHash('sha256').update(JSON.stringify(identityFields.map((field) => identity[field])))
    .digest('hex');
}

export function sameBaselineIdentity(left, right) {
  return Boolean(left && right && identityFields.every((field) => left[field] === right[field]));
}

export function screenshotStateMatches(baselineScreenshot, name, metadata) {
  const expectedScreen = name.startsWith('title') ? 'title' : 'browse';
  return baselineScreenshot?.file === name &&
    baselineScreenshot?.screen === expectedScreen &&
    baselineScreenshot?.screen === metadata?.screen &&
    baselineScreenshot?.titleId === (metadata?.titleId ?? null) &&
    baselineScreenshot?.accountState === metadata?.accountState;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Invalid PNG signature');
  }
  let width;
  let height;
  let bitDepth;
  let colorType;
  let palette;
  let transparency;
  const data = [];
  for (let offset = 8; offset < buffer.length;) {
    if (offset + 12 > buffer.length) throw new Error('Truncated PNG chunk');
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) throw new Error('Truncated PNG data');
    const chunk = buffer.subarray(start, end);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      if (chunk[10] !== 0 || chunk[11] !== 0 || chunk[12] !== 0) {
        throw new Error('Unsupported PNG compression, filter or interlace mode');
      }
    } else if (type === 'PLTE') palette = chunk;
    else if (type === 'tRNS') transparency = chunk;
    else if (type === 'IDAT') data.push(chunk);
    else if (type === 'IEND') break;
    offset = end + 4;
  }
  const channelsByType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByType[colorType];
  if (!width || !height || bitDepth !== 8 || !channels) {
    throw new Error('Only non-interlaced 8-bit PNG screenshots are supported');
  }
  const rowBytes = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  if (raw.length !== (rowBytes + 1) * height) throw new Error('PNG pixel data length is invalid');
  const pixels = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (rowBytes + 1)];
    const rawStart = y * (rowBytes + 1) + 1;
    const rowStart = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const value = raw[rawStart + x];
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const above = y > 0 ? pixels[rowStart - rowBytes + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[rowStart - rowBytes + x - channels] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : filter === 4 ? paeth(left, above, upperLeft)
                : null;
      if (predictor === null) throw new Error(`Unsupported PNG filter ${filter}`);
      pixels[rowStart + x] = (value + predictor) & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const source = i * channels;
    const target = i * 4;
    if (colorType === 6) {
      pixels.copy(rgba, target, source, source + 4);
    } else if (colorType === 2) {
      pixels.copy(rgba, target, source, source + 3);
      rgba[target + 3] = 255;
    } else if (colorType === 0) {
      rgba.fill(pixels[source], target, target + 3);
      rgba[target + 3] = 255;
    } else if (colorType === 4) {
      rgba.fill(pixels[source], target, target + 3);
      rgba[target + 3] = pixels[source + 1];
    } else {
      const paletteIndex = pixels[source];
      const paletteStart = paletteIndex * 3;
      if (!palette || paletteStart + 2 >= palette.length) throw new Error('PNG palette is invalid');
      rgba[target] = palette[paletteStart];
      rgba[target + 1] = palette[paletteStart + 1];
      rgba[target + 2] = palette[paletteStart + 2];
      rgba[target + 3] = transparency?.[paletteIndex] ?? 255;
    }
  }
  return { width, height, rgba };
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return chunk;
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const target = y * (width * 4 + 1);
    scanlines[target] = 0;
    rgba.copy(scanlines, target + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function comparePngImages(baselinePng, currentPng, channelTolerance = 16) {
  const baseline = decodePng(baselinePng);
  const current = decodePng(currentPng);
  if (baseline.width !== current.width || baseline.height !== current.height) {
    return {
      status: 'incompatible',
      reason: `Image dimensions differ (${baseline.width}x${baseline.height} vs ${current.width}x${current.height})`,
    };
  }
  const diff = Buffer.alloc(current.width * current.height * 4);
  let changedPixels = 0;
  for (let i = 0; i < current.width * current.height; i += 1) {
    const offset = i * 4;
    const changed = [0, 1, 2, 3].some((channel) =>
      Math.abs(baseline.rgba[offset + channel] - current.rgba[offset + channel]) > channelTolerance);
    if (changed) {
      changedPixels += 1;
      diff[offset] = 255;
      diff[offset + 1] = 32;
      diff[offset + 2] = 48;
      diff[offset + 3] = 255;
    } else {
      const gray = Math.round((current.rgba[offset] * 0.299 +
        current.rgba[offset + 1] * 0.587 + current.rgba[offset + 2] * 0.114) * 0.22);
      diff[offset] = gray;
      diff[offset + 1] = gray;
      diff[offset + 2] = gray;
      diff[offset + 3] = 255;
    }
  }
  const totalPixels = current.width * current.height;
  return {
    status: changedPixels ? 'changed' : 'unchanged',
    width: current.width,
    height: current.height,
    changedPixels,
    changedPercent: Number((changedPixels * 100 / totalPixels).toFixed(4)),
    channelTolerance,
    diffPng: encodePng(current.width, current.height, diff),
  };
}

#!/usr/bin/env node
// Generates adaptive-icon-foreground.png for Android adaptive icons.
// Runs on bare Node.js — no native deps, only zlib.
"use strict";
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const SIZE = 1024;

// Colours
const AMBER = [0xF5, 0xC6, 0x19, 0xFF]; // #F5C619
const DARK  = [0x0A, 0x0A, 0x0F, 0xFF]; // #0A0A0F
const TRANS = [0x00, 0x00, 0x00, 0x00]; // transparent

// Rounded-rectangle geometry — keep content within the central 66 % (safe zone)
const MARGIN = Math.round(SIZE * 0.17);   // 174 px
const RR_X   = MARGIN;
const RR_Y   = MARGIN;
const RR_W   = SIZE - 2 * MARGIN;        // 676 px
const RR_H   = SIZE - 2 * MARGIN;
const RADIUS = Math.round(RR_W * 0.16);  // ~108 px

// Play-triangle vertices (right-pointing, centred in the rounded rect)
// Nudge slightly right of centre so it looks optically centred
const CX = RR_X + RR_W / 2 + RR_W * 0.03;
const CY = RR_Y + RR_H / 2;
const TH = RR_H * 0.55; // triangle height (horizontal extent)
const TV = RR_H * 0.60; // triangle vertical span
const TRI = [
  [CX - TH * 0.42, CY - TV / 2], // top-left
  [CX - TH * 0.42, CY + TV / 2], // bottom-left
  [CX + TH * 0.58, CY],          // right tip
];

// ── helpers ────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Signed distance to axis-aligned rounded rectangle. */
function sdfRR(px, py) {
  const qx = Math.abs(px - (RR_X + RR_W / 2)) - RR_W / 2 + RADIUS;
  const qy = Math.abs(py - (RR_Y + RR_H / 2)) - RR_H / 2 + RADIUS;
  return (
    Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2) +
    Math.min(Math.max(qx, qy), 0) -
    RADIUS
  );
}

/** Signed distance to triangle (negative = inside). */
function sdfTri(px, py) {
  const [a, b, c] = TRI;
  function side(p, q) { return (px - q[0]) * (p[1] - q[1]) - (py - q[1]) * (p[0] - q[0]); }
  const d0 = side(a, b);
  const d1 = side(b, c);
  const d2 = side(c, a);
  const inside = (d0 >= 0 && d1 >= 0 && d2 >= 0) || (d0 <= 0 && d1 <= 0 && d2 <= 0);
  if (inside) return -1; // definitely inside

  // Distance to each edge
  function edgeDist(p, q) {
    const ex = q[0] - p[0], ey = q[1] - p[1];
    const t = clamp(((px - p[0]) * ex + (py - p[1]) * ey) / (ex * ex + ey * ey), 0, 1);
    const dx = px - p[0] - t * ex, dy = py - p[1] - t * ey;
    return Math.sqrt(dx * dx + dy * dy);
  }
  return Math.min(edgeDist(a, b), edgeDist(b, c), edgeDist(c, a));
}

/** Alpha from SDF with 1-pixel anti-alias. */
function alphaFromSdf(d) {
  return clamp(0.5 - d, 0, 1);
}

/** Blend src over dst (both [r,g,b,a]). */
function blend(dst, src, alpha) {
  const a = alpha * src[3] / 255;
  const out = new Array(4);
  const dstA = dst[3] / 255;
  const outA = a + dstA * (1 - a);
  if (outA === 0) return TRANS;
  out[0] = Math.round((src[0] * a + dst[0] * dstA * (1 - a)) / outA);
  out[1] = Math.round((src[1] * a + dst[1] * dstA * (1 - a)) / outA);
  out[2] = Math.round((src[2] * a + dst[2] * dstA * (1 - a)) / outA);
  out[3] = Math.round(outA * 255);
  return out;
}

// ── rasterise ──────────────────────────────────────────────────────────────

console.log("Rasterising %dx%d …", SIZE, SIZE);
const rows = [];
for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(1 + SIZE * 4); // filter byte + RGBA
  row[0] = 0; // filter: None
  for (let x = 0; x < SIZE; x++) {
    const dRR  = sdfRR(x + 0.5, y + 0.5);
    const rrA  = alphaFromSdf(dRR);

    let px = [...TRANS];
    if (rrA > 0) {
      const dTri = sdfTri(x + 0.5, y + 0.5);
      const triA = alphaFromSdf(dTri);
      // Paint amber rect first, then dark triangle on top
      px = blend(px, AMBER, rrA);
      if (triA > 0) {
        px = blend(px, DARK, triA * (AMBER[3] / 255)); // triangle only inside AA amber region
      }
    }
    const off = 1 + x * 4;
    row[off]     = px[0];
    row[off + 1] = px[1];
    row[off + 2] = px[2];
    row[off + 3] = px[3];
  }
  rows.push(row);
  if (y % 128 === 0) process.stdout.write(".");
}
console.log(" done");

// ── PNG encoder ────────────────────────────────────────────────────────────

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let c = 0xffffffff;
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeB = Buffer.from(type, "ascii");
  const len   = u32be(data.length);
  const crc   = u32be(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([len, typeB, data, crc]);
}

const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8]  = 8;   // bit depth
ihdr[9]  = 6;   // colour type: RGBA
ihdr[10] = 0;   // compression
ihdr[11] = 0;   // filter
ihdr[12] = 0;   // interlace

const raw  = Buffer.concat(rows);
const idat = zlib.deflateSync(raw, { level: 6 });

const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = path.join(__dirname, "..", "assets", "images");
const outPath = path.join(outDir, "adaptive-icon-foreground.png");
fs.writeFileSync(outPath, png);
console.log("Written →", outPath, `(${(png.length / 1024).toFixed(1)} KB)`);

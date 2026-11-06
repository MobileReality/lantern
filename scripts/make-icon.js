#!/usr/bin/env node
'use strict';

// Generates the Lantern icons — a red lantern with a warm flame:
//   build/icon.png            1024  navy rounded tile + lantern  (app/dock icon)
//   src/assets/trayTemplate.png / @2x  monochrome lantern on transparent (menu bar)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const NAVY = [4, 13, 35];
const RED = [245, 49, 3];
const WARM_GLOW = [255, 150, 70];
const WARM_CORE = [255, 216, 150];

function buf(w, h) {
  return new Uint8ClampedArray(w * h * 4);
}

function blend(b, w, x, y, col, a) {
  if (x < 0 || y < 0 || x >= w || a <= 0) return;
  const i = (y * w + x) * 4;
  if (i + 3 >= b.length) return;
  const ia = 1 - a;
  b[i] = col[0] * a + b[i] * ia;
  b[i + 1] = col[1] * a + b[i + 1] * ia;
  b[i + 2] = col[2] * a + b[i + 2] * ia;
  b[i + 3] = Math.max(b[i + 3], a * 255);
}

function disc(b, w, h, cx, cy, r, col) {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      blend(b, w, x, y, col, Math.max(0, Math.min(1, r + 0.5 - d)));
    }
  }
}

function seg(b, w, h, x0, y0, x1, y1, width, col) {
  const r = width / 2;
  const minX = Math.floor(Math.min(x0, x1) - r - 1);
  const maxX = Math.ceil(Math.max(x0, x1) + r + 1);
  const minY = Math.floor(Math.min(y0, y1) - r - 1);
  const maxY = Math.ceil(Math.max(y0, y1) + r + 1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let t = ((x - x0) * dx + (y - y0) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
      blend(b, w, x, y, col, Math.max(0, Math.min(1, r + 0.5 - d)));
    }
  }
}

function roundedTile(b, w, h, radius, col) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.min(x, w - 1 - x);
      const cy = Math.min(y, h - 1 - y);
      let a = 1;
      if (cx < radius && cy < radius) {
        const d = Math.hypot(radius - cx, radius - cy);
        a = Math.max(0, Math.min(1, radius - d + 0.5));
      }
      blend(b, w, x, y, col, a);
    }
  }
}

function arc(b, w, h, cx, cy, r, a0, a1, width, col) {
  const steps = Math.max(8, Math.round(((a1 - a0) * r) / 2));
  let px = cx + r * Math.cos(a0);
  let py = cy + r * Math.sin(a0);
  for (let i = 1; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    seg(b, w, h, px, py, x, y, width, col);
    px = x;
    py = y;
  }
}

// A lantern centred in the tile: a red cage with cap, handle and base, and a warm
// two-tone flame inside. `warm` is null for the monochrome menu-bar silhouette.
function drawLantern(b, w, h, size, col, warm) {
  const cx = w / 2;
  const cy = h / 2;
  const halfW = size * 0.22;
  const top = cy - size * 0.2;
  const bot = cy + size * 0.3;
  const t = Math.max(1, size * 0.06);

  seg(b, w, h, cx - halfW, top, cx + halfW, top, t, col); // cage: top / bottom / sides
  seg(b, w, h, cx - halfW, bot, cx + halfW, bot, t, col);
  seg(b, w, h, cx - halfW, top, cx - halfW, bot, t, col);
  seg(b, w, h, cx + halfW, top, cx + halfW, bot, t, col);
  seg(b, w, h, cx - halfW * 0.72, top - t * 1.3, cx + halfW * 0.72, top - t * 1.3, t * 1.5, col); // cap
  seg(b, w, h, cx - halfW * 0.6, bot + t * 1.3, cx + halfW * 0.6, bot + t * 1.3, t * 1.5, col); // base
  arc(b, w, h, cx, top - t * 1.3, halfW * 0.62, Math.PI, 2 * Math.PI, t * 0.8, col); // handle

  const fy = cy + size * 0.04;
  if (warm) {
    disc(b, w, h, cx, fy, size * 0.12, warm.glow);
    disc(b, w, h, cx, fy, size * 0.07, warm.core);
  } else {
    disc(b, w, h, cx, fy, size * 0.07, col);
  }
}

function crc32(data) {
  let c = ~0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngBuffer(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const block = (type, body) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, body])), 0);
    return Buffer.concat([len, t, body, crc]);
  };
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), block('IHDR', ihdr), block('IDAT', idat), block('IEND', Buffer.alloc(0))]);
}

function png(file, w, h, rgba) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, pngBuffer(w, h, rgba));
  console.log('wrote', file, `${w}x${h}`);
}

// Windows .ico holding PNG-encoded entries (supported since Vista) — pure Node, no
// platform tooling required.
function ico(file, sizes) {
  const imgs = sizes.map((s) => ({ s, data: pngBuffer(s, s, brandTile(s)) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(imgs.length, 4);
  const dir = Buffer.alloc(16 * imgs.length);
  let offset = 6 + dir.length;
  imgs.forEach((img, i) => {
    const e = i * 16;
    dir[e] = img.s >= 256 ? 0 : img.s;
    dir[e + 1] = img.s >= 256 ? 0 : img.s;
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(img.data.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += img.data.length;
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, dir, ...imgs.map((i) => i.data)]));
  console.log('wrote', file, `(${sizes.join(', ')})`);
}

// Navy rounded tile + red lantern at any size, using the same proportions as the 1024 icon.
function brandTile(size) {
  const b = buf(size, size);
  roundedTile(b, size, size, Math.round(size * 0.219), NAVY);
  drawLantern(b, size, size, size * 0.62, RED, { glow: WARM_GLOW, core: WARM_CORE });
  return b;
}

const root = path.join(__dirname, '..');

// App / dock icon (+ .icns via macOS tooling)
{
  const W = 1024;
  const b = buf(W, W);
  roundedTile(b, W, W, 224, NAVY);
  drawLantern(b, W, W, W * 0.62, RED, { glow: WARM_GLOW, core: WARM_CORE });
  const iconPng = path.join(root, 'build', 'icon.png');
  png(iconPng, W, W, b);
  fs.copyFileSync(iconPng, path.join(root, 'src', 'assets', 'appicon.png')); // packaged for app.dock.setIcon
  try {
    const set = path.join(root, 'build', 'icon.iconset');
    fs.rmSync(set, { recursive: true, force: true });
    fs.mkdirSync(set, { recursive: true });
    for (const s of [16, 32, 64, 128, 256, 512]) {
      execFileSync('sips', ['-z', s, s, iconPng, '--out', path.join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' });
      execFileSync('sips', ['-z', s * 2, s * 2, iconPng, '--out', path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' });
    }
    fs.copyFileSync(iconPng, path.join(set, 'icon_512x512@2x.png'));
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(root, 'build', 'icon.icns')], { stdio: 'ignore' });
    console.log('wrote build/icon.icns');
  } catch (e) {
    console.warn('icns generation skipped:', e.message);
  }
}

// Menu-bar template icon (monochrome; macOS recolors it per appearance)
for (const [name, S] of [
  ['trayTemplate.png', 22],
  ['trayTemplate@2x.png', 44],
]) {
  const b = buf(S, S);
  drawLantern(b, S, S, S * 0.82, [0, 0, 0], null);
  png(path.join(root, 'src', 'assets', name), S, S, b);
}

// Colored tray icon for Windows/Linux (template images render black there)
png(path.join(root, 'src', 'assets', 'trayColor.png'), 32, 32, brandTile(32));
png(path.join(root, 'src', 'assets', 'trayColor@2x.png'), 64, 64, brandTile(64));

// Windows app icon
ico(path.join(root, 'build', 'icon.ico'), [16, 32, 48, 64, 128, 256]);

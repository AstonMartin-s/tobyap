import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

// CRC32
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function png(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// distancia de punto a segmento
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy; return Math.hypot(px - cx, py - cy);
}

function render(size, { maskable = false } = {}) {
  const g = [0, 128, 105]; // #008069
  const rgba = Buffer.alloc(size * size * 4);
  const pad = maskable ? 0 : size * 0.06;
  const r = maskable ? 0 : size * 0.22; // radio esquinas
  const inRounded = (x, y) => {
    const minx = pad, miny = pad, maxx = size - pad, maxy = size - pad;
    if (x < minx || x > maxx || y < miny || y > maxy) return false;
    // esquinas redondeadas
    const cx = Math.min(Math.max(x, minx + r), maxx - r);
    const cy = Math.min(Math.max(y, miny + r), maxy - r);
    return Math.hypot(x - cx, y - cy) <= r + 0.5 || (x >= minx + r && x <= maxx - r) || (y >= miny + r && y <= maxy - r);
  };
  // Geometría de la "K"
  const th = size * 0.09; // grosor
  const barX = size * 0.34;
  const top = size * 0.30, bot = size * 0.70, mid = size * 0.50;
  const armX = size * 0.66;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRounded(x + 0.5, y + 0.5)) { rgba[i + 3] = 0; continue; }
      rgba[i] = g[0]; rgba[i + 1] = g[1]; rgba[i + 2] = g[2]; rgba[i + 3] = 255;
      // "K" blanca
      const inBar = Math.abs(x - barX) <= th / 2 && y >= top && y <= bot;
      const inUp = distSeg(x, y, barX, mid, armX, top) <= th / 2;
      const inDn = distSeg(x, y, barX, mid, armX, bot) <= th / 2;
      if (inBar || inUp || inDn) { rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255; }
    }
  }
  return png(size, size, rgba);
}

const out = path.resolve('public');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'chat-icon-512.png'), render(512, { maskable: true }));
fs.writeFileSync(path.join(out, 'chat-icon-192.png'), render(192, { maskable: true }));
fs.writeFileSync(path.join(out, 'chat-apple-180.png'), render(180, { maskable: false }));
console.log('íconos generados en public/: chat-icon-512, chat-icon-192, chat-apple-180');

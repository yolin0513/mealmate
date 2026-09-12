// 產生 App 圖示（純 Node，無相依；PNG 編碼與有號距離場沿用 StockDiary）。
// 設計：暖白底圓角方塊 ＋ 一個番茄紅的盤子（外圈）＋ 米白內圈 ＋ 右上一枚青綠的葉點。
// 明亮、跟廚房有關、沒有任何醫療符號。

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = fileURLToPath(new URL('../icons/', import.meta.url));
mkdirSync(OUT, { recursive: true });

// ---------- PNG 編碼 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.subarray(y * width * 4, (y + 1) * width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 形狀 ----------
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const cover = (d, aa) => clamp01(0.5 - d / aa);
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdCircle(px, py, cx, cy, r) { return Math.hypot(px - cx, py - cy) - r; }

const CREAM = [255, 247, 236];
const TOMATO = [255, 107, 74];
const TOMATO_DEEP = [232, 84, 54];
const GREEN = [72, 187, 120];
const CHOP = [214, 169, 118];

function draw(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const aa = size / 220;
  const inset = maskable ? size * 0.18 : size * 0.09;
  const bgR = size * 0.22;
  const content = size - inset * 2;
  const cx = size / 2;
  const cy = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      let [r, g, b] = CREAM;
      const bgA = maskable ? 1 : cover(sdRoundRect(px, py, cx, cy, size / 2 - size * 0.02, size / 2 - size * 0.02, bgR), aa);
      let a = bgA;
      const put = (col, cov) => {
        if (cov <= 0) return;
        r = Math.round(r * (1 - cov) + col[0] * cov);
        g = Math.round(g * (1 - cov) + col[1] * cov);
        b = Math.round(b * (1 - cov) + col[2] * cov);
        a = Math.max(a, cov * bgA);
      };

      // 盤子：番茄紅外圈，往右下略深
      const plateR = content * 0.36;
      const t = clamp01((px + py) / (size * 2));
      const plate = TOMATO.map((v, i) => Math.round(v + (TOMATO_DEEP[i] - v) * t));
      put(plate, cover(sdCircle(px, py, cx, cy + content * 0.03, plateR), aa));
      // 內圈米白
      put(CREAM, cover(sdCircle(px, py, cx, cy + content * 0.03, plateR * 0.62), aa));
      // 兩根筷子（斜放在盤子右側）
      const ang = -0.95;
      const rot = (dx, dy) => [dx * Math.cos(ang) - dy * Math.sin(ang), dx * Math.sin(ang) + dy * Math.cos(ang)];
      for (const off of [-content * 0.035, content * 0.035]) {
        const [ox, oy] = rot(off, 0);
        const [lx, ly] = rot(px - (cx + content * 0.22), py - (cy + content * 0.05));
        const d = sdRoundRect(lx, ly, ox, oy, content * 0.014, content * 0.30, content * 0.012);
        put(CHOP, cover(d, aa));
      }
      // 右上一枚青綠葉點
      const leafR = content * 0.09;
      put(GREEN, cover(sdCircle(px, py, inset + content * 0.80, inset + content * 0.20, leafR), aa));
      put(CREAM, cover(sdRoundRect(px, py, inset + content * 0.80, inset + content * 0.20, leafR * 0.55, leafR * 0.12, leafR * 0.12), aa));

      const o = (y * size + x) * 4;
      buf[o] = r; buf[o + 1] = g; buf[o + 2] = b;
      buf[o + 3] = Math.round(clamp01(a) * 255);
    }
  }
  return png(size, size, buf);
}

const files = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
];
for (const [name, size, opts] of files) {
  const buf = draw(size, opts);
  writeFileSync(path.join(OUT, name), buf);
  console.log(`${name}  ${size}×${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}

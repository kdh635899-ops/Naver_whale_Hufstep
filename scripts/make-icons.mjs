// 네이비 둥근 사각형 위에 흰색 'W'를 그린 PNG 아이콘을 만든다 (Node 기본 모듈만 사용).
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
// 점 (px,py)와 선분 사이 거리
const segDist = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const W = [[0.24, 0.3], [0.37, 0.72], [0.5, 0.42], [0.63, 0.72], [0.76, 0.3]];

function icon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size * 0.22, stroke = size * 0.07;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // 필터 없음
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      // 둥근 모서리 바깥은 투명
      const qx = Math.max(r - cx, 0, cx - (size - r)), qy = Math.max(r - cy, 0, cy - (size - r));
      const inside = Math.hypot(qx, qy) <= r;
      let px = [0, 0, 0, 0];
      if (inside) {
        const t = cy / size; // 위→아래 그라데이션 (#1A4F8F → #0B2A5B)
        px = [Math.round(26 - 15 * t), Math.round(79 - 37 * t), Math.round(143 - 52 * t), 255];
        let d = Infinity;
        for (let i = 0; i < W.length - 1; i++) d = Math.min(d, segDist(cx / size, cy / size, W[i], W[i + 1]) * size);
        if (d <= stroke) px = [255, 255, 255, 255];
      }
      raw.set(px, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
for (const s of [16, 48, 128]) writeFileSync(`public/icons/icon${s}.png`, icon(s));
console.log('icons written');

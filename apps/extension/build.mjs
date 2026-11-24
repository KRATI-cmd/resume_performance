import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const watch = process.argv.includes('--watch');

/** Dependency-free PNG: indigo disc with a white "A"-like chevron, transparent corners. */
function makeIcon(size) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };

  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const inDisc = Math.hypot(x + 0.5 - c, y + 0.5 - c) <= c - 0.5;
      // Chevron "A": two strokes meeting at the top centre, plus a crossbar.
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      const stroke = 0.075;
      const left = Math.abs(u - (0.5 - (v - 0.25) * 0.55)) < stroke && v > 0.25 && v < 0.78;
      const right = Math.abs(u - (0.5 + (v - 0.25) * 0.55)) < stroke && v > 0.25 && v < 0.78;
      const bar = v > 0.55 && v < 0.62 && u > 0.36 && u < 0.64;
      const white = inDisc && (left || right || bar);
      raw[o] = white ? 255 : 79;
      raw[o + 1] = white ? 255 : 70;
      raw[o + 2] = white ? 255 : 229;
      raw[o + 3] = inDisc ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
for (const size of [16, 48, 128]) await writeFile(`dist/icon${size}.png`, makeIcon(size));

const options = {
  entryPoints: { popup: 'src/popup.ts', background: 'src/background.ts' },
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}

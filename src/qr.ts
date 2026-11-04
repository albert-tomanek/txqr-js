// Thin wrappers around paulmillr's `qr`, rendering at an exact pixel size the
// way the original's go-qrcode did.

import encodeQR from "qr";
import decodeQR from "qr/decode.js";
import type { Image, ReadOptions, RenderOptions } from "./mod.ts";

export const ECC_LEVELS = ["low", "medium", "quartile", "high"] as const;

/** QR modules including the quiet zone; true = dark. */
export function qrMatrix(text: string, opts: Required<RenderOptions>): boolean[][] {
  return encodeQR(text, "raw", {
    ecc: opts.ecc,
    border: opts.border,
    // Frames are always alphanumeric; letting the library sniff would also
    // pick it, but being explicit fails loudly on a malformed frame.
    encoding: /^[0-9A-Z $%*+\-./:]*$/.test(text) ? "alphanumeric" : "byte",
  });
}

export function qrSVG(text: string, opts: Required<RenderOptions>): string {
  const m = qrMatrix(text, opts);
  const n = m.length;
  let path = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n;) {
      if (!m[y][x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < n && m[y][x + run]) run++;
      path += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  }
  const s = opts.size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" ` +
    `viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="#fff"/><path fill="#000" d="${path}"/></svg>`;
}

/** RGBA pixels, size x size, nearest-neighbour scaled. */
export function qrImage(text: string, opts: Required<RenderOptions>): Image {
  const m = qrMatrix(text, opts);
  const n = m.length;
  const s = opts.size;
  const data = new Uint8Array(s * s * 4);
  const map = new Int32Array(s);
  for (let i = 0; i < s; i++) map[i] = Math.floor((i * n) / s);
  for (let y = 0; y < s; y++) {
    const row = m[map[y]];
    for (let x = 0; x < s; x++) {
      const v = row[map[x]] ? 0 : 255;
      const o = (y * s + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { width: s, height: s, data };
}

export function qrRead(image: Image, opts: ReadOptions = {}): string | undefined {
  try {
    return decodeQR(image, opts);
  } catch {
    return undefined;
  }
}

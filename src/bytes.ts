// Byte helpers that don't rely on TextEncoder/atob/btoa, so they also work
// in QuickJS and other bare ECMAScript engines.

export function utf8Encode(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const lo = str.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // lone surrogate
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    } else {
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 63),
        0x80 | ((c >> 6) & 63),
        0x80 | (c & 63),
      );
    }
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let c = 0xfffd;
    let n = 1;
    if (b < 0x80) c = b;
    else if (b >= 0xc2 && b < 0xe0) n = 2;
    else if (b >= 0xe0 && b < 0xf0) n = 3;
    else if (b >= 0xf0 && b < 0xf5) n = 4;
    if (n > 1) {
      let cp = b & (0xff >> (n + 1));
      let ok = i + n <= bytes.length;
      for (let j = 1; ok && j < n; j++) {
        const cb = bytes[i + j];
        if ((cb & 0xc0) !== 0x80) ok = false;
        else cp = (cp << 6) | (cb & 63);
      }
      const min = n === 2 ? 0x80 : n === 3 ? 0x800 : 0x10000;
      if (ok && cp >= min && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) {
        c = cp;
      } else {
        n = 1;
      }
    }
    out += String.fromCodePoint(c);
    i += n;
  }
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INV = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_INV[B64.charCodeAt(i)] = i;

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[n >> 18] + B64[(n >> 12) & 63] + "==";
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + "=";
  }
  return out;
}

export function fromBase64(str: string): Uint8Array {
  const s = str.replace(/[\s=]+/g, "");
  if (s.length % 4 === 1) throw new TypeError("invalid base64 length");
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64_INV[c] : -1;
    if (v < 0) throw new TypeError(`invalid base64 character at ${i}`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

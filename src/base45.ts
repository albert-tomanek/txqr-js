// Base45 (RFC 9285). Its alphabet is exactly the QR alphanumeric charset, so
// a base45 string fits in the QR code's alphanumeric mode (5.5 bits/char),
// wasting only ~3% versus raw byte mode.

export const BASE45_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

const INV = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE45_CHARSET.length; i++) {
  INV[BASE45_CHARSET.charCodeAt(i)] = i;
}

export function base45Length(byteLength: number): number {
  return Math.floor(byteLength / 2) * 3 + (byteLength % 2) * 2;
}

export function base45Encode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 1 < bytes.length; i += 2) {
    let n = (bytes[i] << 8) | bytes[i + 1];
    const c = n % 45;
    n = (n - c) / 45;
    const d = n % 45;
    const e = (n - d) / 45;
    out += BASE45_CHARSET[c] + BASE45_CHARSET[d] + BASE45_CHARSET[e];
  }
  if (i < bytes.length) {
    const n = bytes[i];
    out += BASE45_CHARSET[n % 45] + BASE45_CHARSET[Math.floor(n / 45)];
  }
  return out;
}

export function base45Decode(str: string): Uint8Array {
  if (str.length % 3 === 1) throw new TypeError("invalid base45 length");
  const out = new Uint8Array(Math.floor(str.length / 3) * 2 + (str.length % 3 === 2 ? 1 : 0));
  const val = (i: number): number => {
    const ch = str.charCodeAt(i);
    const v = ch < 128 ? INV[ch] : -1;
    if (v < 0) throw new TypeError(`invalid base45 character at ${i}`);
    return v;
  };
  let o = 0;
  let i = 0;
  for (; i + 2 < str.length; i += 3) {
    const n = val(i) + val(i + 1) * 45 + val(i + 2) * 2025;
    if (n > 0xffff) throw new TypeError(`invalid base45 triplet at ${i}`);
    out[o++] = n >> 8;
    out[o++] = n & 0xff;
  }
  if (i < str.length) {
    const n = val(i) + val(i + 1) * 45;
    if (n > 0xff) throw new TypeError(`invalid base45 pair at ${i}`);
    out[o++] = n;
  }
  return out;
}

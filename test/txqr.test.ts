import { assert, assertEquals, assertThrows } from "@std/assert";
import { base45Decode, base45Encode } from "../src/base45.ts";
import {
  DEFAULTS,
  Decoder,
  encode,
  Encoder,
  fromBase64,
  readQR,
  renderImage,
  toBase64,
  utf8Decode,
  utf8Encode,
} from "../src/mod.ts";

// Deterministic test data (xorshift32).
function randomBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

Deno.test("base45 round-trips and matches RFC 9285 examples", () => {
  assertEquals(base45Encode(utf8Encode("AB")), "BB8");
  assertEquals(base45Encode(utf8Encode("Hello!!")), "%69 VD92EX0");
  assertEquals(utf8Decode(base45Decode("QED8WEX0")), "ietf!");
  for (const n of [0, 1, 2, 3, 99, 100, 257]) {
    const b = randomBytes(n, n + 7);
    assertEquals(base45Decode(base45Encode(b)), b);
  }
  assertThrows(() => base45Decode("GGW")); // 65535 < value: invalid
});

Deno.test("utf8 and base64 helpers match the web platform", () => {
  const s = "héllo wörld — 😀 ✓";
  assertEquals(utf8Encode(s), new TextEncoder().encode(s));
  assertEquals(utf8Decode(new TextEncoder().encode(s)), s);
  for (const n of [0, 1, 2, 3, 4, 50]) {
    const b = randomBytes(n, n + 3);
    const b64 = toBase64(b);
    assertEquals(b64, btoa(String.fromCharCode(...b)));
    assertEquals(fromBase64(b64), b);
  }
});

Deno.test("defaults come from the original txqr tools", () => {
  assertEquals(DEFAULTS.chunkSize, 100);
  assertEquals(DEFAULTS.redundancy, 2);
  assertEquals(DEFAULTS.size, 300);
  assertEquals(DEFAULTS.ecc, "medium");
  assert(!("frameDuration" in DEFAULTS), "frame timing belongs to the app");
  const e = new Encoder("x".repeat(1000));
  assertEquals(e.blockCount, 10);
  assertEquals(e.frameCount, 20);
});

Deno.test("frames are pure QR alphanumeric", () => {
  for (const f of encode(randomBytes(500))) assert(/^[0-9A-Z $%*+\-./:]+$/.test(f), f);
});

Deno.test("small message fits in one frame", () => {
  const frames = encode("hi");
  assertEquals(frames.length, 1);
  const d = new Decoder();
  assert(d.push(frames[0]));
  assertEquals(d.text(), "hi");
});

Deno.test("empty message", () => {
  const d = new Decoder();
  assert(d.push(encode(new Uint8Array(0))[0]));
  assertEquals(d.bytes().length, 0);
});

Deno.test("in-order lossless transfer needs exactly k frames", () => {
  const data = randomBytes(5000);
  const e = new Encoder(data);
  const d = new Decoder();
  for (let i = 0; i < e.blockCount - 1; i++) assert(!d.push(e.frame(i)));
  assert(d.push(e.frame(e.blockCount - 1)));
  assertEquals(d.bytes(), data);
});

Deno.test("recovers with heavy loss, random order, duplicates", () => {
  let worst = 0;
  for (let trial = 0; trial < 30; trial++) {
    const data = randomBytes(3000 + trial * 37, trial + 1);
    const e = new Encoder(data, { chunkSize: 80 });
    const d = new Decoder();
    const rand = randomBytes(10000, trial + 99);
    let r = 0;
    let used = 0;
    // Drop ~50% of frames; start mid-stream; keep sending past the loop.
    for (let code = trial * 5; !d.complete; code++) {
      if (rand[r++ % rand.length] < 128) continue;
      d.push(e.frame(code));
      d.push(e.frame(code)); // camera repeat
      used++;
      assert(code < 2000, "decoder did not converge");
    }
    assertEquals(d.bytes(), data);
    worst = Math.max(worst, used / e.blockCount);
  }
  assert(worst < 1.3, `worst overhead ${worst}`);
});

Deno.test("a new transfer restarts an incomplete decoder", () => {
  const a = new Encoder(randomBytes(1000, 1));
  const b = new Encoder(randomBytes(1000, 2));
  const d = new Decoder();
  d.push(a.frame(0));
  d.push(a.frame(1));
  for (let i = 0; !d.push(b.frame(i)); i++);
  assertEquals(d.bytes(), randomBytes(1000, 2));
  d.push(a.frame(5)); // ignored once complete
  assertEquals(d.bytes(), randomBytes(1000, 2));
});

Deno.test("rejects malformed frames and oversized transfers", () => {
  const d = new Decoder({ maxBlocks: 5 });
  assert(!Decoder.isFrame("hello"));
  assert(!Decoder.isFrame("0/100/5/00000000:ABC")); // wrong payload length
  assertThrows(() => d.push("hello"), TypeError);
  assertThrows(() => d.push(new Encoder(randomBytes(1000)).frame(0)), RangeError);
});

Deno.test("render -> read round-trip through pixels", () => {
  for (const ecc of ["low", "medium", "quartile", "high"] as const) {
    const e = new Encoder(randomBytes(2000), { ecc, chunkSize: 200, size: 400 });
    const d = new Decoder();
    for (let i = 0; !d.complete; i++) {
      const img = e.renderImage(i);
      assertEquals([img.width, img.height, img.data.length], [400, 400, 400 * 400 * 4]);
      d.pushImage(img);
      assert(i < e.frameCount);
    }
    assertEquals(d.bytes(), randomBytes(2000));
  }
  assertEquals(readQR(renderImage("HELLO")), "HELLO");
  assertEquals(readQR({ width: 10, height: 10, data: new Uint8Array(400) }), undefined);
});

Deno.test("SVG output has the requested size", () => {
  const svg = new Encoder("hello", { size: 123 }).renderSVG(0);
  assert(svg.startsWith("<svg") && svg.includes('width="123"'));
});

Deno.test("pushBytes takes natively decoded QR payloads", () => {
  const data = randomBytes(3000, 9);
  const e = new Encoder(data);
  const d = new Decoder();
  const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  assert(Decoder.isFrame(ascii(e.frame(0))));
  assert(!Decoder.isFrame(ascii("https://example.com")));
  for (let i = 0; !d.complete; i++) {
    const bytes = ascii(e.frame(i));
    // Alternate Uint8Array, ArrayBuffer and an offset view into a bigger buffer.
    if (i % 3 === 0) d.pushBytes(bytes);
    else if (i % 3 === 1) d.pushBytes(bytes.buffer);
    else {
      const big = new Uint8Array(bytes.length + 8);
      big.set(bytes, 4);
      d.pushBytes(big.subarray(4, 4 + bytes.length));
    }
  }
  assertEquals(d.bytes(), data);
  assertThrows(() => new Decoder().pushBytes(ascii("not a frame")), TypeError);
});

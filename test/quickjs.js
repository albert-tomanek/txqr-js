// Smoke test of the built bundle under QuickJS: `qjs --std test/quickjs.js`
// (run `deno task build` first). Proves dist/txqr.js needs nothing beyond
// plain ECMAScript.
import * as std from "std";
import { DEFAULTS, Decoder, Encoder, fromBase64, readQR, renderImage, toBase64 } from "../dist/txqr.js";

let failed = 0;
function check(name, fn) {
  try {
    fn();
    print(`ok   ${name}`);
  } catch (e) {
    failed++;
    print(`FAIL ${name}: ${e && e.stack || e}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}
function bytesEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
function randomBytes(n, seed) {
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

check("defaults", () => {
  assert(DEFAULTS.chunkSize === 100 && DEFAULTS.frameDuration === 200 && DEFAULTS.size === 300);
});

check("text round-trip with loss", () => {
  const msg = "Hello from QuickJS — ünïcödé 😀 ".repeat(50);
  const e = new Encoder(msg);
  const d = new Decoder();
  for (let code = 3; !d.complete; code++) {
    if (code % 3 === 0) continue;
    d.push(e.frame(code));
    assert(code < 1000, "did not converge");
  }
  assert(d.text() === msg, "text mismatch");
});

check("binary through rendered pixels", () => {
  const data = randomBytes(1500, 42);
  const e = new Encoder(data, { chunkSize: 250, ecc: "low", size: 360 });
  const d = new Decoder();
  for (let i = 0; !d.complete; i++) {
    d.pushImage(e.renderImage(i));
    assert(i < e.frameCount, "did not converge");
  }
  assert(bytesEqual(d.bytes(), data), "bytes mismatch");
});

check("readQR / base64", () => {
  assert(readQR(renderImage("QUICKJS")) === "QUICKJS");
  const b = randomBytes(31, 7);
  assert(bytesEqual(fromBase64(toBase64(b)), b));
});

check("SVG render", () => {
  assert(new Encoder("x").renderSVG(0).startsWith("<svg"));
});

if (failed) {
  print(`${failed} failed`);
  std.exit(1);
}
print("all passed");

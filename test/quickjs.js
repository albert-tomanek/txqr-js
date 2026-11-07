// Smoke test of the built bundle under QuickJS: `qjs --std test/quickjs.js`
// (run `deno task build` first). Proves dist/txqr.mjs needs nothing beyond
// plain ECMAScript.
import * as std from "std";
import * as TxQR from "../dist/txqr.mjs";

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
  assert(TxQR.DEFAULTS.chunkSize === 800 && TxQR.DEFAULTS.size === 300 && !("frameDuration" in TxQR.DEFAULTS));
});

check("text round-trip with loss", () => {
  const msg = "Hello from QuickJS — ünïcödé 😀 ".repeat(50);
  const e = new TxQR.Encoder(msg);
  const d = new TxQR.Decoder();
  for (let code = 3; !d.complete; code++) {
    if (code % 3 === 0) continue;
    d.push(e.frame(code));
    assert(code < 1000, "did not converge");
  }
  assert(d.text() === msg, "text mismatch");
});

check("binary through rendered pixels", () => {
  const data = randomBytes(1500, 42);
  const e = new TxQR.Encoder(data, { chunkSize: 250, ecc: "low", size: 360 });
  const d = new TxQR.Decoder();
  for (let i = 0; !d.complete; i++) {
    d.pushImage(e.renderImage(i));
    assert(i < e.frameCount, "did not converge");
  }
  assert(bytesEqual(d.bytes(), data), "bytes mismatch");
});

check("pushBytes (natively decoded payloads)", () => {
  const data = randomBytes(2000, 11);
  const e = new TxQR.Encoder(data);
  const d = new TxQR.Decoder();
  for (let i = 0; !d.complete; i++) {
    const s = e.frame(i);
    const bytes = new Uint8Array(s.length);
    for (let j = 0; j < s.length; j++) bytes[j] = s.charCodeAt(j);
    d.pushBytes(i % 2 ? bytes : bytes.buffer);
    assert(i < 100, "did not converge");
  }
  assert(bytesEqual(d.bytes(), data), "bytes mismatch");
});

check("readQR / base64", () => {
  assert(TxQR.readQR(TxQR.renderImage("QUICKJS")) === "QUICKJS");
  const b = randomBytes(31, 7);
  assert(bytesEqual(TxQR.fromBase64(TxQR.toBase64(b)), b));
});

check("SVG render", () => {
  assert(new TxQR.Encoder("x").renderSVG(0).startsWith("<svg"));
});

if (failed) {
  print(`${failed} failed`);
  std.exit(1);
}
print("all passed");

// Test page logic. Served by web/serve.ts in development; inlined into
// dist/demo.html by scripts/build.ts.
import * as TxQR from "./txqr.mjs";

const $ = (id) => document.getElementById(id);
const PARAMS = ["chunkSize", "redundancy", "size", "border", "ecc"];
// Frame timing is the app's job, not the library's. 200 ms (5 FPS) is the
// original txqr-gif default.
const DEFAULT_FRAME_DURATION = 200;
let frameDuration = DEFAULT_FRAME_DURATION;

let payload = null;     // Uint8Array from a chosen file, else the textarea is used
let payloadName = "";   // that file's name, sent along for the receiver to save it under
let encoder = null;
let startTime = 0;
let shown = -1;
let timer = 0;
const decoder = new TxQR.Decoder();
let decodeStart = 0;
let lastDecoded = "";
let stream = null;

function loadDefaults() {
  for (const p of PARAMS) $(p).value = TxQR.DEFAULTS[p];
  $("frameDuration").value = DEFAULT_FRAME_DURATION;
}

function options() {
  const o = {};
  for (const p of PARAMS) o[p] = p === "ecc" ? $(p).value : Number($(p).value);
  if (payload) o.name = payloadName;
  return o;
}

function start() {
  stop();
  try {
    frameDuration = Number($("frameDuration").value);
    if (!(frameDuration > 0)) throw new RangeError(`invalid frame duration: ${frameDuration}`);
    encoder = new TxQR.Encoder(payload ?? $("text").value, options());
  } catch (e) {
    $("sendStats").textContent = `error: ${e.message}`;
    return;
  }
  startTime = performance.now();
  shown = -1;
  tick();
}

function stop() {
  clearTimeout(timer);
  encoder = null;
}

// Timer-driven so frames keep their exact duration even if rendering is slow.
function tick() {
  if (!encoder) return;
  const t = performance.now() - startTime;
  const i = Math.floor(t / frameDuration) % encoder.frameCount;
  if (i !== shown) {
    shown = i;
    try {
      $("qr").innerHTML = encoder.renderSVG(i);
    } catch (e) {
      $("sendStats").textContent = `error: ${e.message}`;
      stop();
      return;
    }
    $("sendStats").textContent =
      (encoder.options.name ? `file ${encoder.options.name}\n` : "") +
      `size ${encoder.size} B, ${encoder.blockCount} blocks, ${encoder.frameCount} frames/loop\n` +
      `${(1000 / frameDuration).toFixed(1)} FPS, loop ${((encoder.frameCount * frameDuration) / 1000).toFixed(1)} s\n` +
      `frame ${i}: ${encoder.frame(i).length} chars`;
    if ($("source").value === "loopback") receiveLoopback(i);
  }
  const next = (Math.floor(t / frameDuration) + 1) * frameDuration;
  timer = setTimeout(tick, Math.max(0, next - t));
}

function receiveLoopback(i) {
  if (decoder.complete) return;
  if (Math.random() * 100 < Number($("loss").value)) return updateRecv("dropped");
  // Read the frame back from pixels, like a camera would (minus the blur).
  const text = TxQR.readQR(encoder.renderImage(i));
  receive(text);
}

function receive(text) {
  if (text === undefined || !TxQR.Decoder.isFrame(text)) return updateRecv(text === undefined ? "no QR" : "not txqr");
  if (decoder.received === 0) decodeStart = performance.now();
  try {
    decoder.push(text);
  } catch (e) {
    return updateRecv(`error: ${e.message}`);
  }
  lastDecoded = text.slice(0, text.indexOf(":"));
  updateRecv("ok");
  if (decoder.complete) showResult();
}

function updateRecv(last) {
  $("progress").value = decoder.progress;
  $("recvStats").textContent =
    `${decoder.received} frames received, ${(decoder.progress * 100).toFixed(0)}% solved` +
    (decoder.blockCount ? ` (${decoder.blockCount} blocks needed)` : "") +
    `\nlast: ${last}${lastDecoded ? `, header ${lastDecoded}` : ""}` +
    (decoder.complete ? `\ncomplete in ${((performance.now() - decodeStart) / 1000).toFixed(2)} s` : "");
}

function showResult() {
  const bytes = decoder.bytes();
  const text = TxQR.utf8Decode(bytes);
  // The name comes from the sender; keep only its last path component.
  const name = decoder.name?.split(/[\\/]/).pop() || "txqr-received.bin";
  $("output").textContent = decoder.name !== undefined || text.includes("�")
    ? `${name}: ${bytes.length} bytes`
    : text;
  const a = $("download");
  URL.revokeObjectURL(a.href);
  a.href = URL.createObjectURL(new Blob([bytes]));
  a.download = name;
  a.textContent = `Download ${name}`;
  a.hidden = false;
}

function resetReceiver() {
  decoder.reset();
  lastDecoded = "";
  $("output").textContent = "";
  $("download").hidden = true;
  updateRecv("-");
}

async function setSource() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $("video").hidden = true;
  if ($("source").value !== "camera") return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch (e) {
    $("recvStats").textContent = `camera error: ${e.message}`;
    return;
  }
  const video = $("video");
  video.srcObject = stream;
  video.hidden = false;
  await video.play();
  const canvas = $("camCanvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const loop = () => {
    if (!stream) return;
    if (video.videoWidth && !decoder.complete) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const text = TxQR.readQR(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (text !== undefined) receive(text);
    }
    requestAnimationFrame(loop);
  };
  loop();
}

$("start").onclick = start;
$("stop").onclick = stop;
$("defaults").onclick = () => { loadDefaults(); if (encoder) start(); };
$("reset").onclick = resetReceiver;
$("source").onchange = setSource;
$("text").oninput = () => { payload = null; $("file").value = ""; };
$("file").onchange = async () => {
  const f = $("file").files[0];
  payload = f ? new Uint8Array(await f.arrayBuffer()) : null;
  payloadName = f ? f.name : "";
};
for (const p of [...PARAMS, "frameDuration"]) $(p).onchange = () => { if (encoder) start(); };

// Installable app (PWA) and Android share target, see web/sw.js. Needs a
// secure origin (https, or http://localhost), so it is skipped elsewhere.
async function receiveShared() {
  if (!new URLSearchParams(location.search).has("shared")) return;
  history.replaceState(null, "", location.pathname);
  const cache = await caches.open("txqr");
  const key = new URL("shared", navigator.serviceWorker.controller?.scriptURL ?? location.href).href;
  const res = await cache.match(key);
  if (!res) return;
  await cache.delete(key);
  const name = res.headers.get("x-name");
  if (name !== null) {
    const file = new File([await res.blob()], decodeURIComponent(name), { type: res.headers.get("content-type") });
    payload = new Uint8Array(await file.arrayBuffer());
    payloadName = file.name;
    const dt = new DataTransfer();
    dt.items.add(file);
    $("file").files = dt.files;
  } else {
    $("text").value = await res.text();
    payload = null;
    $("file").value = "";
  }
  start();
}

loadDefaults();
resetReceiver();
setSource();
if (window.isSecureContext && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("service worker:", e.message));
  receiveShared().catch((e) => $("sendStats").textContent = `share error: ${e.message}`);
}

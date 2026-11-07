// Test page logic. Served by web/serve.ts in development; inlined into
// dist/demo.html by scripts/build.ts.
import * as TxQR from "./txqr.mjs";

const $ = (id) => document.getElementById(id);
const PARAMS = ["chunkSize", "redundancy", "size", "border", "ecc"];
// Frame timing is the app's job, not the library's. 5 FPS (200 ms per frame)
// is the original txqr-gif default.
const DEFAULT_FPS = 5;
let frameDuration = 1000 / DEFAULT_FPS;

// Preset buttons for fields that have them, plus "Custom", which prompts.
// The value lives in a hidden input inside the .presets group.
const PRESETS = {
  chunkSize: { label: "Chunk size (bytes)", choices: [["Large", 800], ["Small", 200]] },
  fps: { label: "Frames per second", choices: [["High", 20], ["Low", 5]] },
};

function setPreset(id, value) {
  $(id).value = value;
  const group = $(id).parentElement;
  let matched = false;
  for (const b of group.querySelectorAll("button[data-value]")) {
    const on = Number(b.dataset.value) === Number(value);
    b.setAttribute("aria-pressed", on);
    matched ||= on;
  }
  const custom = group.querySelector("button.custom");
  custom.setAttribute("aria-pressed", !matched);
  custom.textContent = matched ? "Custom" : `Custom: ${value}`;
}

for (const group of document.querySelectorAll(".presets")) {
  const id = group.dataset.for;
  const { label, choices } = PRESETS[id];
  for (const [name, value] of choices) {
    const b = document.createElement("button");
    b.textContent = name;
    b.dataset.value = value;
    b.onclick = () => { setPreset(id, value); if (encoder) start(); };
    group.append(b);
  }
  const custom = document.createElement("button");
  custom.className = "custom";
  custom.textContent = "Custom";
  custom.onclick = () => {
    const input = prompt(label, $(id).value);
    if (input === null) return;
    const value = Number(input);
    if (!(value > 0)) return alert(`Not a positive number: ${input}`);
    setPreset(id, value);
    if (encoder) start();
  };
  group.append(custom);
}

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
  for (const p of PARAMS) {
    if (p in PRESETS) setPreset(p, TxQR.DEFAULTS[p]);
    else $(p).value = TxQR.DEFAULTS[p];
  }
  setPreset("fps", DEFAULT_FPS);
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
    const fps = Number($("fps").value);
    if (!(fps > 0)) throw new RangeError(`invalid FPS: ${fps}`);
    frameDuration = 1000 / fps;
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

let cameraId = null; // deviceId of the camera in use; null picks the back camera

async function setSource() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $("video").hidden = $("nextCamera").hidden = true;
  $("cameraName").textContent = "";
  if ($("source").value !== "camera") return;
  let s;
  try {
    s = await navigator.mediaDevices.getUserMedia({
      video: cameraId ? { deviceId: { exact: cameraId } } : { facingMode: "environment" },
    });
  } catch (e) {
    $("recvStats").textContent = `camera error: ${e.message}`;
    return;
  }
  stream = s;
  const track = s.getVideoTracks()[0];
  cameraId = track.getSettings().deviceId ?? null;
  $("cameraName").textContent = track.label;
  // Device labels are only available once camera access has been granted.
  const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  $("nextCamera").hidden = cameras.length < 2;
  const video = $("video");
  video.srcObject = stream;
  video.hidden = false;
  await video.play();
  const canvas = $("camCanvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const loop = () => {
    if (stream !== s) return; // this camera was stopped or replaced
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
$("nextCamera").onclick = async () => {
  const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  const i = cameras.findIndex((d) => d.deviceId === cameraId);
  cameraId = cameras[(i + 1) % cameras.length].deviceId;
  setSource();
};
$("text").oninput = () => { payload = null; $("file").value = ""; };
$("file").onchange = async () => {
  const f = $("file").files[0];
  payload = f ? new Uint8Array(await f.arrayBuffer()) : null;
  payloadName = f ? f.name : "";
};
for (const p of PARAMS) if (!(p in PRESETS)) $(p).onchange = () => { if (encoder) start(); };

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

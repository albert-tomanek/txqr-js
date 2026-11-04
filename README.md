# txqr (TypeScript)

A TypeScript rewrite of the library parts of [divan/txqr](https://github.com/divan/txqr):
send data through an animated sequence of QR codes. It uses a fountain code, so the
receiver can start at any frame and recover from missed frames.

It builds to one self-contained ES module, `dist/txqr.js`, with paulmillr's
[`qr`](https://github.com/paulmillr/qr) included. Types are in `dist/txqr.d.ts`. The
module uses only plain ECMAScript (no DOM, `TextEncoder` or timers), so the same file
runs in browsers and in QuickJS.

## Tasks (Deno)

```sh
deno task build   # type-check, then write dist/txqr.js + dist/txqr.d.ts
deno task test    # Deno tests on the source, then QuickJS on dist/txqr.js (needs qjs)
deno task check   # type-check everything
deno task serve        # test page on http://<host>:8000/ (build first)
deno task serve:https  # same on https://<host>:8443/, needed for phone cameras
```

## Usage

```js
import { Encoder, Decoder } from "./txqr.js";

const enc = new Encoder(bytesOrString, { chunkSize: 100, frameDuration: 200 });
// Show enc.renderSVG(enc.indexAt(elapsedMs)), or use renderImage() for RGBA pixels
// or renderMatrix() for the raw module grid.

const dec = new Decoder();
dec.pushImage({ width, height, data });  // camera frame, RGBA (or set opts.format)
// ...or dec.push(frameText) if you read the QR codes yourself
if (dec.complete) use(dec.bytes());
```

Options and their defaults (from the original `txqr-gif` tool), exported as `DEFAULTS`:

| option          | default    | meaning                                |
| --------------- | ---------- | -------------------------------------- |
| `chunkSize`     | 100        | payload bytes per frame                |
| `redundancy`    | 2          | frames per loop = blocks × redundancy  |
| `frameDuration` | 200 ms     | time each frame is shown (5 FPS)       |
| `size`          | 300 px     | rendered QR width/height               |
| `ecc`           | `"medium"` | `low` / `medium` / `quartile` / `high` |
| `border`        | 4          | quiet zone, in modules                 |

## Differences from the Go original (not wire-compatible)

- Frames are `code/chunkSize/size/CRC32:base45data`. Every character is in QR's
  alphanumeric set, which stores about 1.37× more data per code than the original's
  base64-in-byte-mode.
- The fountain code is systematic: the first k frames are the plain blocks. Later frames
  are sparse random XOR combinations, decoded by incremental Gaussian elimination.
  Recovery needs about k + 1.5 frames on average, whatever order or losses they arrive in.
- A CRC-32 of the whole message checks the result and identifies the transfer, so the
  decoder resets itself when a different transfer starts.

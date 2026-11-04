# AGENTS.md

Notes for coding agents working in this repo. User-facing docs are in README.md.

## What this is

A TypeScript rewrite of the library parts of divan/txqr: data sent as an animated QR
sequence using a fountain code. It is **not** wire-compatible with the Go original, by
design. The build output is one ES module that must run unchanged in browsers,
QuickJS (embedded in desktop apps) and Qt's QML engine (QV4).

## Layout

- `src/mod.ts`: public API (Encoder, Decoder, render/read helpers, DEFAULTS, option types).
- `src/fountain.ts`: systematic sparse random linear fountain code and the GF(2) solver.
- `src/frame.ts`: frame wire format `code/chunkSize/size/CRC32HEX:base45`.
- `src/base45.ts`, `src/bytes.ts`: base45, UTF-8, base64, CRC-32 (no web APIs).
- `src/qr.ts`: wrappers over the `qr` package (paulmillr), the only runtime dependency.
- `scripts/build.ts`: builds everything in `dist/`.
- `test/txqr.test.ts`: Deno tests. `test/quickjs.js` and `test/qml.qml` test the built
  bundle in QuickJS and Qt.
- `web/index.html` + `web/app.js`: test page. `web/serve.ts`: dev server (http or https).
- `dist/`: committed build output (`txqr.mjs`, `txqr.d.ts`, `demo.html`). Rebuild it
  after any change to `src/` or `web/`; never edit it by hand.
- `README.md`: anything until the horizontal line is human written and should not be touched.

## Commands

Deno may not be on PATH (on the original machine it is `~/.bin/deno`).

```sh
deno task build      # required before the QuickJS/QML tests and the server
deno task test       # Deno tests + QuickJS (qjs) test of dist/txqr.mjs
deno task test:qml   # Qt QML test (qml6), sets QV4_GC_TIMELIMIT=0
deno task check
deno task serve      # or serve:https; LAN access may need a firewall rule for the port
```

Run `build`, `test` and `test:qml` before finishing any change to `src/`.

## Portability rules (the important part)

The same file must work in QuickJS and QV4, which lag behind browsers:

- **No DOM or web APIs in `src/`**: no `TextEncoder`/`TextDecoder`, `atob`/`btoa`,
  `setTimeout`, `performance`, canvas or fetch. Use the helpers in `src/bytes.ts`.
- **No `#private` class fields.** esbuild lowers them to WeakMaps, and QV4 (Qt 6.8)
  segfaults on those. Use TypeScript `private _name` instead. The build fails if the
  output contains `WeakMap`.
- **The output is lowered to ES2016** by esbuild in `scripts/build.ts`, because QV4
  rejects newer syntax (e.g. `catch {}`, async functions). Newer syntax is fine in the
  source as long as esbuild can lower it. Runtime APIs are not polyfilled, so avoid ones
  newer than ES2016 that QV4 lacks.
- **Keep the API synchronous** with plain-data inputs and outputs, so hosts can call it
  through simple bridges.
- **QR decoding in JS must stay optional.** Hosts may decode QR codes natively and feed
  only the content via `Decoder.push(text)` or `Decoder.pushBytes(bytes)`; only
  `pushImage` and `readQR` use the JS QR reader. Keep those paths independent, and keep
  the README's "Decoding QR codes outside JS" section current when the Decoder API
  changes.
- **Use only the synchronous `decodeQR`** from `qr`. Its async/batch API needs timers,
  and `qr/dom.js` needs the DOM.
- Qt 6.8's incremental GC can also crash under allocation load regardless of our code.
  The workaround is `QV4_GC_TIMELIMIT=0`, documented in the README.

## Design decisions to keep

- Frames use only QR alphanumeric characters (base45 payload); the renderer forces
  alphanumeric mode.
- The fountain code: codes `< k` are source blocks verbatim. Codes `>= k` include each
  source block with probability `min(1/2, 2 ln k / k)`, seeded by mulberry32 from
  `(code, k)`. This replaced a robust-soliton LT code, which had a long overhead tail at
  small k. Changing the subset selection breaks compatibility with existing senders.
- The CRC-32 doubles as a transfer id. An incomplete decoder restarts when the transfer
  changes. A complete one ignores input until `reset()`.
- Defaults come from the Go `txqr-gif` tool: chunk 100 B, redundancy 2, 300 px, ECC
  medium, border 4.
- Frame timing (how long each frame shows, looping) is the app's job. Keep the library
  free of clocks and durations; the demo owns its 200 ms default.

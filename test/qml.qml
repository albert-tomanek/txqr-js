// Smoke test of the built bundle in Qt's QML engine (Qt 6.8+):
//   QV4_GC_TIMELIMIT=0 QT_QPA_PLATFORM=offscreen qml6 test/qml.qml
// (`deno task test:qml`; run `deno task build` first). QV4_GC_TIMELIMIT=0
// works around a crash in Qt 6.8's incremental garbage collector.
import QtQml
import "../dist/txqr.mjs" as Txqr

QtObject {
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

    function bytesEqual(a, b) {
        return a.length === b.length && a.every((v, i) => v === b[i]);
    }

    // QR centred in a grey 640x480 frame, like a camera image.
    function cameraFrame(img) {
        const W = 640, H = 480;
        const data = new Uint8Array(W * H * 4).fill(160);
        const ox = (W - img.width) >> 1, oy = (H - img.height) >> 1;
        for (let y = 0; y < img.height; y++)
            data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + oy) * W + ox) * 4);
        return { width: W, height: H, data: data };
    }

    Component.onCompleted: {
        const tests = {
            "defaults": () => Txqr.DEFAULTS.chunkSize === 100 && !("frameDuration" in Txqr.DEFAULTS),
            "text round-trip with loss": () => {
                const msg = "Hello from QML ünïcödé 😀 ".repeat(40);
                const e = new Txqr.Encoder(msg);
                const d = new Txqr.Decoder();
                for (let code = 1; !d.complete && code < 1000; code++)
                    if (code % 3) d.push(e.frame(code));
                return d.text() === msg;
            },
            "binary, many encoders and decoders": () => {
                const data = randomBytes(20000, 5);
                for (let r = 0; r < 5; r++) {
                    const e = new Txqr.Encoder(data, { chunkSize: 200 });
                    const d = new Txqr.Decoder();
                    for (let i = 0; !d.complete && i < 1000; i++)
                        if (i % 4) d.push(e.frame(i));
                    if (!bytesEqual(d.bytes(), data)) return false;
                }
                return true;
            },
            "read from camera-sized frames": () => {
                const data = randomBytes(1500, 42);
                const e = new Txqr.Encoder(data, { chunkSize: 250, ecc: "low", size: 360 });
                const d = new Txqr.Decoder();
                for (let i = 0; !d.complete && i < e.frameCount; i++)
                    d.pushImage(cameraFrame(e.renderImage(i)));
                return bytesEqual(d.bytes(), data);
            },
            "pushBytes (natively decoded payloads)": () => {
                const data = randomBytes(2000, 11);
                const e = new Txqr.Encoder(data);
                const d = new Txqr.Decoder();
                for (let i = 0; !d.complete && i < 100; i++) {
                    const s = e.frame(i);
                    const bytes = new Uint8Array(s.length);
                    for (let j = 0; j < s.length; j++) bytes[j] = s.charCodeAt(j);
                    d.pushBytes(i % 2 ? bytes : bytes.buffer);
                }
                return bytesEqual(d.bytes(), data);
            },
            "SVG render": () => new Txqr.Encoder("x").renderSVG(0).startsWith("<svg"),
        };
        let failed = 0;
        for (const name in tests) {
            let ok = false;
            try {
                ok = tests[name]();
            } catch (err) {
                console.log(`     ${err}`);
            }
            console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
            if (!ok) failed++;
        }
        console.log(failed ? `${failed} failed` : "all passed");
        Qt.exit(failed ? 1 : 0);
    }
}

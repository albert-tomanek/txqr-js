// Builds dist/txqr.mjs (one self-contained ES module, qr included),
// dist/txqr.d.ts, and dist/demo.html (the test page with everything inlined,
// usable without a server). The demo's PWA files, sw.js and
// manifest.webmanifest, are copied next to it. Run with `deno task build`.
//
// The bundle is lowered to ES2016 so Qt's QML engine (QV4, Qt 6.8) can load
// it; QML also only imports ES modules named *.mjs. Browsers and QuickJS
// take it as-is.

import * as esbuild from "esbuild";

const deno = Deno.execPath();
const OUT = "dist/txqr.mjs";

async function run(args: string[]): Promise<void> {
  const { code } = await new Deno.Command(deno, { args, stdout: "inherit", stderr: "inherit" })
    .output();
  if (code !== 0) Deno.exit(code);
}

await run(["check", "src/mod.ts"]);
await run(["bundle", "--platform=browser", "--declaration", "-o", OUT, "src/mod.ts"]);

// deno bundle has no target option, so lower and minify with esbuild.
const lowered = await esbuild.transform(await Deno.readTextFile(OUT), {
  target: "es2016",
  format: "esm",
  minify: true,
  legalComments: "inline",
});
await Deno.writeTextFile(OUT, lowered.code);

// Demo: bundle web/app.js against the built library and inline it.
const absOut = new URL(`../${OUT}`, import.meta.url).pathname;
const app = await esbuild.build({
  entryPoints: ["web/app.js"],
  bundle: true,
  write: false,
  format: "esm",
  target: "es2020",
  minify: true,
  legalComments: "inline",
  plugins: [{
    name: "txqr",
    setup(b) {
      b.onResolve({ filter: /^\.\/txqr\.mjs$/ }, () => ({ path: absOut }));
    },
  }],
});
await esbuild.stop();
const page = await Deno.readTextFile("web/index.html");
const tag = '<script type="module" src="./app.js"></script>';
if (!page.includes(tag)) throw new Error(`web/index.html lacks ${tag}`);
const inline = app.outputFiles[0].text.replaceAll("</script", "<\\/script");
await Deno.writeTextFile(
  "dist/demo.html",
  page.replace(tag, () => `<script type="module">${inline}</script>`),
);
for (const f of ["sw.js", "manifest.webmanifest"]) await Deno.copyFile(`web/${f}`, `dist/${f}`);

// QV4 crashes on the WeakMaps esbuild emits for lowered #private fields; use
// TypeScript `private` instead.
if (lowered.code.includes("WeakMap")) {
  console.error(`${OUT} uses WeakMap (lowered #private fields?), which crashes Qt's QML engine`);
  Deno.exit(1);
}

// deno bundle names the declarations after the output file.
const dtsOut = "dist/txqr.d.ts";
for (const emitted of ["dist/txqr.d.mts", "dist/txqr.mjs.d.ts"]) {
  try {
    await Deno.rename(emitted, dtsOut);
  } catch {
    // not this name
  }
}
// The emitted declarations are correct but oddly wrapped; tidy them.
await run(["fmt", "--quiet", "--no-config", dtsOut]);

const dts = await Deno.readTextFile(dtsOut);
if (/^\s*import\b/m.test(dts)) {
  console.error(`${dtsOut} is not self-contained (has imports)`);
  Deno.exit(1);
}

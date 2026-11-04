// Builds dist/txqr.js (one self-contained ES module, qr included) and
// dist/txqr.d.ts. Run with `deno task build`.

const deno = Deno.execPath();

async function run(args: string[]): Promise<void> {
  const { code } = await new Deno.Command(deno, { args, stdout: "inherit", stderr: "inherit" })
    .output();
  if (code !== 0) Deno.exit(code);
}

await run(["check", "src/mod.ts"]);
await run([
  "bundle",
  "--platform=browser",
  "--minify",
  "--declaration",
  "-o",
  "dist/txqr.js",
  "src/mod.ts",
]);
// The emitted declarations are correct but oddly wrapped; tidy them.
await run(["fmt", "--quiet", "--no-config", "dist/txqr.d.ts"]);

const dts = await Deno.readTextFile("dist/txqr.d.ts");
if (/^\s*import\b/m.test(dts)) {
  console.error("dist/txqr.d.ts is not self-contained (has imports)");
  Deno.exit(1);
}

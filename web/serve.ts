// Serves the test page and the built bundle on all interfaces, so other
// devices on the LAN can open it. Run `deno task build` first.
//
//   deno task serve [port]         http, default port 8000
//   deno task serve:https [port]   https, default port 8443
//
// Browsers only grant camera access on https (or localhost), so use https to
// scan from a phone. It uses a self-signed certificate, generated with openssl
// into .cert/ on first run for localhost and this machine's current IPv4
// addresses; delete .cert/ to regenerate after the LAN address changes. Each
// device must accept the certificate warning once.

const ROUTES: Record<string, [string, string]> = {
  "/": ["web/index.html", "text/html; charset=utf-8"],
  "/app.js": ["web/app.js", "text/javascript; charset=utf-8"],
  "/txqr.mjs": ["dist/txqr.mjs", "text/javascript; charset=utf-8"],
  "/demo.html": ["dist/demo.html", "text/html; charset=utf-8"],
};

const https = Deno.args.includes("--https");
const portArg = Deno.args.find((a) => !a.startsWith("--"));
const port = Number(portArg ?? (https ? 8443 : 8000));

const CERT = ".cert/cert.pem";
const KEY = ".cert/key.pem";

function lanAddresses(): string[] {
  return Deno.networkInterfaces()
    .filter((i) => i.family === "IPv4" && i.address !== "127.0.0.1")
    .map((i) => i.address);
}

async function ensureCert(): Promise<void> {
  try {
    await Deno.stat(CERT);
    await Deno.stat(KEY);
    return;
  } catch {
    // generate below
  }
  await Deno.mkdir(".cert", { recursive: true });
  const san = ["DNS:localhost", "IP:127.0.0.1", ...lanAddresses().map((a) => `IP:${a}`)];
  const { code, stderr } = await new Deno.Command("openssl", {
    args: [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
      "-keyout", KEY, "-out", CERT,
      "-subj", "/CN=txqr test page",
      "-addext", `subjectAltName=${san.join(",")}`,
    ],
  }).output();
  if (code !== 0) throw new Error(`openssl failed: ${new TextDecoder().decode(stderr)}`);
  console.log(`Generated self-signed certificate for ${san.join(", ")}`);
}

const tls = https
  ? await ensureCert().then(async () => ({
    cert: await Deno.readTextFile(CERT),
    key: await Deno.readTextFile(KEY),
  }))
  : {};

Deno.serve({
  hostname: "0.0.0.0",
  port,
  ...tls,
  onListen() {
    const scheme = https ? "https" : "http";
    for (const host of ["localhost", ...lanAddresses()]) console.log(`  ${scheme}://${host}:${port}/`);
  },
}, async (req) => {
  const route = ROUTES[new URL(req.url).pathname];
  if (!route) return new Response("not found", { status: 404 });
  try {
    const body = await Deno.readFile(route[0]);
    return new Response(body, { headers: { "content-type": route[1], "cache-control": "no-store" } });
  } catch {
    return new Response(`${route[0]} missing (run \`deno task build\`)`, { status: 500 });
  }
});

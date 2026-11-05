// Service worker for the installable demo (PWA). It does two things:
//
// - Receives Android's share sheet: the manifest's share_target POSTs the shared
//   file/text here. It is stored in the Cache API and the page is opened with
//   ?shared, where web/app.js picks it up and starts sending it.
// - Keeps the app usable offline: network first, cached copy as fallback.

const CACHE = "txqr";
const SHARED = "shared"; // cache key for the last shared item, relative to the scope

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === "POST" && url.searchParams.has("share-target")) {
    e.respondWith(receiveShare(req, url));
  } else if (req.method === "GET" && url.origin === location.origin) {
    e.respondWith(networkFirst(req));
  }
});

async function receiveShare(req, url) {
  const form = await req.formData();
  const file = form.get("file");
  const cache = await caches.open(CACHE);
  if (file instanceof File && file.size) {
    await cache.put(SHARED, new Response(file, {
      headers: { "content-type": file.type || "application/octet-stream", "x-name": encodeURIComponent(file.name) },
    }));
  } else {
    // Text shares: Android puts links in "text" or "url", sometimes with a title.
    const text = ["title", "text", "url"].map((k) => form.get(k)).filter(Boolean).join("\n");
    await cache.put(SHARED, new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } }));
  }
  url.search = "?shared";
  return Response.redirect(url.href, 303);
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const key = req.url.replace(/[?#].*/, ""); // one cached copy per file
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(key)) ?? Promise.reject(err);
  }
}

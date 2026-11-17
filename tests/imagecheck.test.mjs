// The worker's image downloads (extension/imagecheck.js): only real images by their first
// bytes, and a download stops as soon as it passes the size cap.
import assert from "node:assert/strict";
import fs from "node:fs";
import { sniffImageType, readCapped } from "../extension/imagecheck.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const bytes = (...parts) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const pad = (b, n = 32) => { const out = new Uint8Array(Math.max(n, b.length)); out.set(b); return out; };

// 1. the formats manga sites serve
const png = fs.readFileSync(new URL("./fixtures/demo-page.png", import.meta.url));
ok(sniffImageType(png) === "image/png", "a real PNG file");
ok(sniffImageType(pad(bytes([0xff, 0xd8, 0xff, 0xe0]))) === "image/jpeg", "JPEG");
ok(sniffImageType(pad(bytes("GIF89a"))) === "image/gif", "GIF");
ok(sniffImageType(pad(bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 "))) === "image/webp", "WebP");
ok(sniffImageType(pad(bytes([0, 0, 0, 0x1c], "ftypavif"))) === "image/avif", "AVIF");
ok(sniffImageType(pad(bytes([0, 0, 0, 0x18], "ftypheic"))) === "image/heif", "HEIF");
ok(sniffImageType(pad(bytes("BM", [0x36, 0x10, 0, 0], [0, 0, 0, 0], [0x36, 0, 0, 0], [40, 0, 0, 0]))) === "image/bmp", "BMP");
ok(sniffImageType(png.buffer.slice(png.byteOffset, png.byteOffset + png.length)) === "image/png", "an ArrayBuffer works too");

// 2. what isn't an image, whatever the server says it is
ok(sniffImageType(bytes("<!doctype html><title>Login</title>")) === null, "HTML (a login page)");
ok(sniffImageType(bytes('{"user":"me","token":"x"}')) === null, "JSON (an API answer)");
ok(sniffImageType(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>")) === null, "SVG is not accepted");
ok(sniffImageType(pad(bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "))) === null, "a RIFF file that isn't WebP");
ok(sniffImageType(pad(bytes([0, 0, 0, 0x18], "ftypisom"))) === null, "an MP4 video");
ok(sniffImageType(new Uint8Array(0)) === null, "an empty answer");
ok(sniffImageType(bytes("BM")) === null, "two bytes that only look like BMP");
ok(sniffImageType(bytes("BM-internal-config: secret=1234567890")) === null, "text that happens to start with BM");

// 3. the size cap
const stream = (chunks, onCancel) => new ReadableStream({
  start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); },
  cancel() { onCancel?.(); },
});
{
  const got = await readCapped(new Response(stream([png.subarray(0, 1000), png.subarray(1000)])), 25 * 1048576);
  ok(got.length === png.length && sniffImageType(got) === "image/png", "chunks put back together in order");
}
{
  let cancelled = false, pulled = 0;
  const body = new ReadableStream({
    pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); if (pulled > 1000) c.close(); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readCapped(new Response(body), 4096), /too large/);
  ok(cancelled, "the download is cancelled once past the cap");
  ok(pulled < 10, `it stops reading straight away (read ${pulled} chunks)`);
}
{
  let read = false;
  const res = { headers: new Headers({ "content-length": String(30 * 1048576) }), body: { getReader() { read = true; } } };
  await assert.rejects(readCapped(res, 25 * 1048576), /over 25 MB/);
  ok(!read, "a declared size over the cap stops before reading");
}
{
  const res = { headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(5000) }; // no stream
  await assert.rejects(readCapped(res, 4096), /too large/);
  ok(true, "without a stream, the cap still applies");
}
ok((await readCapped(new Response(new Uint8Array(4096)), 4096)).length === 4096, "exactly the cap is allowed");

console.log(`imagecheck: ${checks} checks passed`);

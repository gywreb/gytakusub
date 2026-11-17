// The worker downloads images for the content script, which runs inside other people's
// pages. Chrome's guidance is to treat content scripts as less trustworthy: an extension
// that fetches whatever URL it is handed and passes the bytes back acts as a proxy past the
// page's own security. So a download is used only if its bytes really are an image (by its
// first bytes, not the server's Content-Type, which image servers often get wrong), and it
// stops as soon as it passes the size cap instead of reading it all first.

/** The image type from the first bytes, or null. JPEG, PNG, GIF, WebP, AVIF/HEIF, BMP. */
export function sniffImageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const at = (i, ...v) => v.every((x, k) => b[i + k] === x);
  const ascii = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(4, "ftyp") && ["avif", "avis", "heic", "heix", "mif1", "msf1"].some((brand) => ascii(8, brand))) return ascii(8, "avi") ? "image/avif" : "image/heif";
  if (ascii(0, "BM") && b.length > 14) return "image/bmp";
  return null;
}

/**
 * Reads a fetch Response, stopping with an error once it is larger than `max` bytes
 * (a Content-Length above it stops before reading anything).
 * @returns {Promise<Uint8Array>}
 */
export async function readCapped(res, max) {
  const declared = Number(res.headers?.get?.("content-length"));
  if (declared > max) throw new Error(`Image is too large (over ${Math.round(max / 1048576)} MB)`);
  if (!res.body?.getReader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > max) throw new Error(`Image is too large (over ${Math.round(max / 1048576)} MB)`);
    return buf;
  }
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { reader.cancel().catch(() => {}); throw new Error(`Image is too large (over ${Math.round(max / 1048576)} MB)`); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

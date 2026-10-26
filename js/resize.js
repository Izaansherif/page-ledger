/**
 * Resize a chosen image file in the browser before upload.
 * Long edge max 1600px, JPEG quality 0.8 (Stage 1 spec).
 *
 * Uses an <img> decode + canvas draw (not createImageBitmap) so that iPhone
 * HEIC/JPEG EXIF rotation works the same way the browser displays the photo.
 * Modern browsers apply EXIF orientation to the decoded bitmap, so the canvas
 * output and naturalWidth/Height are already oriented.
 *
 * Returns { blob, base64, mime, width, height, kb }.
 */
export async function resizeImageToJpeg(file, maxLongEdge = 1600, quality = 0.8) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("This file could not be opened as an image."));
      el.src = objectUrl;
    });

    const w0 = img.naturalWidth || 0;
    const h0 = img.naturalHeight || 0;
    if (!w0 || !h0) throw new Error("The photo has no visible size. Try a different photo.");

    const scale = Math.min(1, maxLongEdge / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "medium";
    ctx.fillStyle = "#ffffff"; // flatten transparency behind JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("The photo could not be converted for upload."))),
        "image/jpeg",
        quality,
      );
    });
    const buf = await blob.arrayBuffer();
    let base64 = "";
    const bytes = new Uint8Array(buf);
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      base64 += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    base64 = btoa(base64);

    return { blob, base64, mime: "image/jpeg", width: w, height: h, kb: Math.round(blob.size / 1024 * 10) / 10 };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

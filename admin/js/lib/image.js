/* ==========================================================================
   HOUSE OF ALDEN ADMIN — getting a photo ready to upload
   --------------------------------------------------------------------------
   Phone photos are 4000px and 5 MB; the shop shows them at 1000px. Each one is
   turned upright (EXIF), scaled to 2000px on its longest side and saved as
   WebP (JPEG where the browser can't write WebP — Safari), before it leaves
   the computer. Uploads are quick on a mobile connection and pages stay light.
   ========================================================================== */

const MAX_SIDE = 2000;
const MAX_BYTES = 8 * 1024 * 1024; // storage.rules refuses anything larger
const MAX_INPUT = 40 * 1024 * 1024;
const ACCEPTED = /^image\/(jpeg|png|webp|avif|heic|heif)$/;

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

export async function prepareImage(file) {
  if (!file || !ACCEPTED.test(file.type || "")) {
    throw new Error(`"${file ? file.name : "That file"}" isn't a photo the shop can use. Choose a JPG, PNG or WebP.`);
  }
  if (file.size > MAX_INPUT) throw new Error(`"${file.name}" is over 40 MB. Choose a smaller photo.`);

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`"${file.name}" couldn't be opened here. Save it as a JPG and try again.`);
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const draw = (background) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas;
  };

  try {
    let blob = await toBlob(draw(null), "image/webp", 0.86);
    if (!blob || blob.type !== "image/webp") {
      /* No WebP encoder: JPEG has no transparency, so lay it on white. */
      const flat = draw("#ffffff");
      blob = await toBlob(flat, "image/jpeg", 0.88);
      if (blob && blob.size > MAX_BYTES) blob = await toBlob(flat, "image/jpeg", 0.72);
    } else if (blob.size > MAX_BYTES) {
      blob = await toBlob(draw(null), "image/webp", 0.7);
    }
    if (!blob) throw new Error(`"${file.name}" couldn't be prepared. Try another photo.`);
    if (blob.size > MAX_BYTES) throw new Error(`"${file.name}" is still over 8 MB after resizing. Choose a smaller photo.`);
    return { blob, type: blob.type, ext: blob.type === "image/webp" ? "webp" : "jpg", width, height };
  } finally {
    if (bitmap.close) bitmap.close();
  }
}

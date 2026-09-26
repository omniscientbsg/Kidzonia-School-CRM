/**
 * Shrinks a phone photo before it leaves the phone (addition b): about 2,000
 * px on the long edge, as JPEG. A 12-megapixel photo drops from ~4 MB to a few
 * hundred KB, which matters on weak mobile networks. The server still checks
 * and re-encodes whatever arrives; this only saves the upload.
 */
export const PHOTO_MAX_SIDE = 2000;

const SHRINKABLE = /^image\/(jpeg|png|webp|heic|heif)$/i;

export async function shrinkPhoto(file: File): Promise<Blob> {
  if (!SHRINKABLE.test(file.type) || typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap;
  try {
    // "from-image" applies the camera's rotation before we draw it.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // The browser can't decode it (e.g. HEIC on most desktops): send it as it is.
    return file;
  }
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.type === 'image/jpeg') {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.85);
  });
  return blob ?? file;
}

/** A file name with the right extension for what we actually send. */
export function uploadName(file: File, sent: Blob): string {
  if (sent === file || sent.type !== 'image/jpeg') return file.name;
  return `${file.name.replace(/\.[^.]*$/, '') || 'photo'}.jpg`;
}

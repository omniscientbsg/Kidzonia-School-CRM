import sharp from 'sharp';
import { invalidInput } from '../lib/errors.js';

export type ImageKind = 'png' | 'jpeg' | 'webp';

export const IMAGE_TYPES: Record<ImageKind, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * The real type, from the file's first bytes. The file name and the
 * Content-Type the browser sent are both chosen by the uploader, so neither
 * is trusted. SVG is deliberately not accepted: it can carry scripts.
 */
export function sniffImage(data: Buffer): ImageKind | null {
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Re-encodes an uploaded image: applies the camera's rotation, caps the size,
 * and writes a fresh file. sharp drops EXIF, GPS and other metadata unless
 * asked to keep it, so nothing about the device or location survives.
 */
export async function cleanImage(
  data: Buffer,
  maxSide: number,
  options: { square?: boolean } = {},
): Promise<{ data: Buffer; kind: ImageKind }> {
  const kind = sniffImage(data);
  if (!kind)
    throw invalidInput('Upload a PNG, JPEG or WebP image.', {
      file: 'Upload a PNG, JPEG or WebP image.',
    });
  try {
    const pipeline = sharp(data, { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate()
      // Square (avatars): crop to the centre, and always to the full size, so
      // every avatar file is the same shape and round frames never show bars.
      .resize({
        width: maxSide,
        height: maxSide,
        fit: options.square ? 'cover' : 'inside',
        withoutEnlargement: !options.square,
      });
    const out =
      kind === 'png'
        ? await pipeline.png().toBuffer()
        : kind === 'jpeg'
          ? await pipeline.jpeg({ quality: 88 }).toBuffer()
          : await pipeline.webp({ quality: 88 }).toBuffer();
    return { data: out, kind };
  } catch {
    throw invalidInput('That image couldn’t be read. Try another file.', {
      file: 'That image couldn’t be read. Try another file.',
    });
  }
}

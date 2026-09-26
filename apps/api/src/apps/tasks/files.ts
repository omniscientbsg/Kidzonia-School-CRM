import { inflateRawSync, inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { cleanImage, IMAGE_TYPES, sniffImage } from '../../core/images.js';
import { invalidInput } from '../../lib/errors.js';

/**
 * Checks task photos and files (addition g, decision 4). The type always
 * comes from the file's contents; the name and the browser's content type
 * are chosen by the uploader and never trusted.
 *
 * - Photos (JPEG, PNG, WebP) are re-encoded: turned upright, shrunk to 2,000
 *   px on the long edge, and stripped of all metadata, including the GPS
 *   location phones add (these are photos of children's classrooms).
 * - PDFs are refused if they carry scripts, launch actions or embedded files,
 *   including inside compressed streams.
 * - Word and Excel only in the modern formats (.docx, .xlsx); macro-enabled
 *   files and the old binary formats are refused.
 * - SVG, HTML and anything else is refused.
 */

export type FileKind = 'jpeg' | 'png' | 'webp' | 'pdf' | 'docx' | 'xlsx';

export const FILE_TYPES: Record<FileKind, { mime: string; ext: string; inline: boolean }> = {
  jpeg: { mime: IMAGE_TYPES.jpeg, ext: 'jpg', inline: true },
  png: { mime: IMAGE_TYPES.png, ext: 'png', inline: true },
  webp: { mime: IMAGE_TYPES.webp, ext: 'webp', inline: true },
  pdf: { mime: 'application/pdf', ext: 'pdf', inline: false },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
    inline: false,
  },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
    inline: false,
  },
};

export const PHOTO_MAX_SIDE = 2000;

const refuse = (message: string) => invalidInput(message, { file: message });

const WHAT_WE_TAKE = 'Upload a photo (JPEG, PNG or WebP), a PDF, or a Word or Excel file.';

// ---------- PDF ----------

/** Names of PDF features that run code or carry other files. */
const PDF_DANGER = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)(?![A-Za-z])/;
const MAX_INFLATED = 20 * 1024 * 1024;

function pdfIsSafe(data: Buffer): boolean {
  const text = data.toString('latin1');
  if (PDF_DANGER.test(text)) return false;
  // Compressed object streams can hide the same names; look inside them too.
  let inflated = 0;
  const stream = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = stream.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    try {
      const out = inflateSync(data.subarray(start, end), { maxOutputLength: MAX_INFLATED });
      inflated += out.length;
      if (PDF_DANGER.test(out.toString('latin1'))) return false;
    } catch {
      // Not a Flate stream (images, fonts); nothing to read.
    }
    if (inflated > MAX_INFLATED) return false;
    // Skip past "endstream", or its own "stream" would match next.
    stream.lastIndex = end + 'endstream'.length;
  }
  return true;
}

// ---------- Office (ZIP) ----------

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

/** Reads a ZIP's central directory: names only, nothing is extracted to disk. */
function zipEntries(data: Buffer): ZipEntry[] | null {
  const min = Math.max(0, data.length - 65_557);
  let eocd = -1;
  for (let i = data.length - 22; i >= min; i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = data.readUInt16LE(eocd + 10);
  let p = data.readUInt32LE(eocd + 16);
  if (count > 5000) return null;
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > data.length || data.readUInt32LE(p) !== 0x02014b50) return null;
    const nameLen = data.readUInt16LE(p + 28);
    const extraLen = data.readUInt16LE(p + 30);
    const commentLen = data.readUInt16LE(p + 32);
    out.push({
      method: data.readUInt16LE(p + 10),
      compressedSize: data.readUInt32LE(p + 20),
      localOffset: data.readUInt32LE(p + 42),
      name: data.subarray(p + 46, p + 46 + nameLen).toString('utf8'),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function zipRead(data: Buffer, e: ZipEntry): string | null {
  const p = e.localOffset;
  if (p + 30 > data.length || data.readUInt32LE(p) !== 0x04034b50) return null;
  const start = p + 30 + data.readUInt16LE(p + 26) + data.readUInt16LE(p + 28);
  const raw = data.subarray(start, start + e.compressedSize);
  try {
    if (e.method === 0) return raw.toString('utf8');
    if (e.method === 8)
      return inflateRawSync(raw, { maxOutputLength: 1024 * 1024 }).toString('utf8');
  } catch {
    return null;
  }
  return null;
}

function officeKind(data: Buffer): FileKind {
  const entries = zipEntries(data);
  if (!entries) throw refuse(WHAT_WE_TAKE);
  const names = new Set(entries.map((e) => e.name));
  const types = entries.find((e) => e.name === '[Content_Types].xml');
  const typesXml = types ? zipRead(data, types) : null;
  if (!typesXml) throw refuse(WHAT_WE_TAKE);
  if (
    /macroEnabled/i.test(typesXml) ||
    entries.some(
      (e) => /(^|\/)vbaProject\.bin$/i.test(e.name) || /(^|\/)vbaData\.xml$/i.test(e.name),
    )
  ) {
    throw refuse('Files with macros (.docm, .xlsm) aren’t allowed. Save it as .docx or .xlsx.');
  }
  if (names.has('word/document.xml')) return 'docx';
  if (names.has('xl/workbook.xml')) return 'xlsx';
  throw refuse('Only Word (.docx) and Excel (.xlsx) documents are allowed.');
}

// ---------- the check ----------

const startsWith = (data: Buffer, bytes: readonly number[]) =>
  data.length >= bytes.length && bytes.every((b, i) => data[i] === b);

export interface CheckedFile {
  data: Buffer;
  kind: FileKind;
  width: number | null;
  height: number | null;
}

export interface FileLimits {
  imageMaxBytes: number;
  documentMaxBytes: number;
}

const mb = (bytes: number) => `${String(Math.round(bytes / (1024 * 1024)))} MB`;

export async function checkUpload(data: Buffer, limits: FileLimits): Promise<CheckedFile> {
  if (data.length === 0) throw refuse('Choose a file to upload.');

  const image = sniffImage(data);
  if (image) {
    if (data.length > limits.imageMaxBytes) {
      throw refuse(`Photos can be up to ${mb(limits.imageMaxBytes)}.`);
    }
    const clean = await cleanImage(data, PHOTO_MAX_SIDE);
    const meta = await sharp(clean.data).metadata();
    return {
      data: clean.data,
      kind: clean.kind,
      width: meta.width,
      height: meta.height,
    };
  }

  if (data.length > limits.documentMaxBytes) {
    throw refuse(`Files can be up to ${mb(limits.documentMaxBytes)}.`);
  }
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') {
    if (!pdfIsSafe(data)) {
      throw refuse('This PDF contains scripts or attached files, so it can’t be uploaded.');
    }
    return { data, kind: 'pdf', width: null, height: null };
  }
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04])) {
    return { data, kind: officeKind(data), width: null, height: null };
  }
  if (startsWith(data, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    throw refuse(
      'Old Word and Excel files (.doc, .xls) aren’t allowed. Save it as .docx or .xlsx.',
    );
  }
  throw refuse(WHAT_WE_TAKE);
}

/**
 * A display name for a file: no folders, no control characters, and the
 * extension of its real type (so "photo.svg" that is really a JPEG shows as .jpg).
 */
export function safeFileName(raw: string | undefined, kind: FileKind): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  const stem = base
    .replace(/\.[^.]*$/, '')
    // eslint-disable-next-line no-control-regex -- stripping control characters on purpose
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '')
    .trim()
    .slice(0, 100);
  return `${stem || 'file'}.${FILE_TYPES[kind].ext}`;
}

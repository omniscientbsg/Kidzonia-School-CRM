import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { localDate, zonedInstant } from '@kidzonia/shared';
import type { TestApp } from './app.js';

/**
 * Puts the app's clock at a fixed time of the seeded day (Asia/Kolkata), so
 * tests about deadlines don't depend on when they run.
 */
export function atLocal(t: TestApp, time: string, dayOffsetMs = 0): Date {
  const today = localDate(new Date(t.clock.now.getTime() + dayOffsetMs), 'Asia/Kolkata');
  t.clock.now = zonedInstant(today, time, 'Asia/Kolkata');
  return t.clock.now;
}

export const todayIn = (t: TestApp) => localDate(t.clock.now, 'Asia/Kolkata');

/** A minimal ZIP writer (stored entries), for building .docx / .xlsx test files. */
export function zip(entries: { name: string; data: string | Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const types = (main: string) =>
  `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.main+xml"/></Types>`;

export const docx = () =>
  zip([
    { name: '[Content_Types].xml', data: types('word/document.xml') },
    { name: 'word/document.xml', data: '<w:document/>' },
  ]);

export const xlsx = () =>
  zip([
    { name: '[Content_Types].xml', data: types('xl/workbook.xml') },
    { name: 'xl/workbook.xml', data: '<workbook/>' },
  ]);

/** A .docm: a Word file with a macro project inside. */
export const docm = () =>
  zip([
    {
      name: '[Content_Types].xml',
      data: types('word/document.xml').replace('main+xml', 'document.macroEnabled.main+xml'),
    },
    { name: 'word/document.xml', data: '<w:document/>' },
    { name: 'word/vbaProject.bin', data: Buffer.from([1, 2, 3]) },
  ]);

/** The start of an old binary Word/Excel file. */
export const oldDoc = () =>
  Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);

export const pdf = (extra = '') =>
  Buffer.from(
    `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R ${extra} >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF`,
    'latin1',
  );

/** A PDF whose script hides inside a compressed stream. */
export function pdfWithHiddenScript(): Buffer {
  const body = deflateSync(Buffer.from('<< /S /JavaScript /JS (app.alert(1)) >>', 'latin1'));
  return Buffer.concat([
    Buffer.from(
      '%PDF-1.5\n4 0 obj << /Length ' + String(body.length) + ' /Filter /FlateDecode >>\nstream\n',
      'latin1',
    ),
    body,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
}

/** A big phone-style photo with GPS and camera metadata. */
export function phonePhoto(width = 4000, height = 3000): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#88aa66' } })
    .withExif({
      IFD0: { Make: 'TestPhone', Model: 'X1', Copyright: 'Someone' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '17/1 25/1 0/1' },
    })
    .jpeg({ quality: 80 })
    .toBuffer();
}

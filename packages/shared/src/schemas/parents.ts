import { z } from 'zod';
import { idSchema } from '../ids.js';
import { MESSAGE_WORDS } from '../tasks/fields.js';
import { normalizeMobile } from './common.js';
import { isoDateSchema } from './tasks.js';

/**
 * Parent contacts and messages to parents (Phase 6, brief 9.12, open decision
 * 13.1 answered: a small contact list in Core, filled from a CSV per school).
 */

export const CONSENTS = ['agreed', 'not_agreed', 'opted_out'] as const;
export type Consent = (typeof CONSENTS)[number];
export const CONSENT_LABEL: Record<Consent, string> = {
  agreed: 'Agreed',
  not_agreed: 'Not agreed',
  opted_out: 'Opted out',
};

/**
 * A phone number as it may appear anywhere outside the contacts screen (logs,
 * the audit log, the message log): only the last three digits.
 */
export function maskMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  if (digits.length < 6) return '•••';
  const country = mobile.startsWith('+91') ? '+91 ' : '';
  return `${country}••••• ••${digits.slice(-3)}`;
}

// ---------- CSV ----------

/** RFC 4180-style CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const COLUMNS = {
  className: ['class', 'class name'],
  studentName: ['student name', 'student', 'child', 'child name', 'child’s name', "child's name"],
  parentName: [
    'parent name',
    'parent',
    'parent’s name',
    "parent's name",
    'guardian',
    'guardian name',
  ],
  mobile: [
    'parent mobile',
    'mobile',
    'phone',
    'parent phone',
    'mobile number',
    'parent’s mobile',
    "parent's mobile",
  ],
  agreed: ['agreed', 'agreed to messages', 'consent', 'agreed to receive messages'],
} as const;
type Column = keyof typeof COLUMNS;
export const CSV_HEADER = 'Class,Student name,Parent name,Parent mobile,Agreed to messages';

const YES = ['yes', 'y', 'true', '1', 'agreed'];
const NO = ['no', 'n', 'false', '0', '', 'not agreed'];

export interface ContactCsvRow {
  /** Line in the file (the header is line 1). */
  line: number;
  className: string;
  studentName: string;
  parentName: string;
  /** E.164, or null when the number couldn't be read. */
  mobile: string | null;
  agreed: boolean;
  errors: string[];
}

export interface ContactCsv {
  /** Problems with the file as a whole (no header, too many rows). */
  problems: string[];
  rows: ContactCsvRow[];
}

/**
 * Reads a parent-contacts CSV and checks each row on its own terms: every
 * column present, a real mobile number, a yes/no answer, no duplicate rows,
 * one name per number. Checks that need the database (unknown class) come after.
 */
export function parseContactsCsv(text: string, maxRows: number): ContactCsv {
  const table = parseCsv(text);
  const header = table[0]?.map((h) => h.trim().toLowerCase().replace(/\s+/g, ' ')) ?? [];
  const index = {} as Record<Column, number>;
  const missing: string[] = [];
  for (const [col, names] of Object.entries(COLUMNS) as [Column, readonly string[]][]) {
    const i = header.findIndex((h) => names.includes(h));
    if (i === -1) missing.push(names[0] ?? col);
    index[col] = i;
  }
  if (table.length === 0) return { problems: ['The file is empty.'], rows: [] };
  if (missing.length > 0) {
    return {
      problems: [
        `The first row must name the columns: ${CSV_HEADER}. Missing: ${missing.join(', ')}.`,
      ],
      rows: [],
    };
  }
  const body = table.slice(1);
  if (body.length > maxRows) {
    return {
      problems: [
        `The file has ${String(body.length)} rows; upload at most ${String(maxRows)} at a time.`,
      ],
      rows: [],
    };
  }
  const seen = new Map<string, number>();
  const nameOfNumber = new Map<string, { name: string; line: number }>();
  const rows = body.map((cells, i): ContactCsvRow => {
    const cell = (c: Column) => (cells[index[c]] ?? '').trim();
    const line = i + 2;
    const errors: string[] = [];
    const className = cell('className');
    const studentName = cell('studentName');
    const parentName = cell('parentName');
    const rawMobile = cell('mobile');
    const rawAgreed = cell('agreed').toLowerCase();
    if (!className) errors.push('Class is missing.');
    if (!studentName) errors.push('Student name is missing.');
    if (!parentName) errors.push('Parent name is missing.');
    if (studentName.length > 100 || parentName.length > 100)
      errors.push('Names can be at most 100 letters.');
    const mobile = rawMobile ? normalizeMobile(rawMobile) : null;
    if (!rawMobile) errors.push('Parent mobile is missing.');
    else if (!mobile) errors.push('The parent mobile isn’t a valid number.');
    const agreed = YES.includes(rawAgreed);
    if (!agreed && !NO.includes(rawAgreed)) errors.push('“Agreed to messages” must be yes or no.');
    if (mobile && studentName && className) {
      const key = `${className.toLowerCase()}|${studentName.toLowerCase()}|${mobile}`;
      const first = seen.get(key);
      if (first !== undefined) errors.push(`Same child and parent as row ${String(first)}.`);
      else seen.set(key, line);
    }
    if (mobile && parentName) {
      const other = nameOfNumber.get(mobile);
      if (other && other.name.toLowerCase() !== parentName.toLowerCase()) {
        errors.push(`This number is given to ${other.name} on row ${String(other.line)}.`);
      } else if (!other) nameOfNumber.set(mobile, { name: parentName, line });
    }
    return { line, className, studentName, parentName, mobile, agreed, errors };
  });
  return { problems: [], rows };
}

// ---------- messages ----------

export type MessageWord = (typeof MESSAGE_WORDS)[number];

/** Fills the fill-in words of a parent message template (brief 9.12). */
export function renderParentMessage(body: string, values: Record<MessageWord, string>): string {
  return body.replace(/\{(\w+)\}/g, (all, word: string) =>
    (MESSAGE_WORDS as readonly string[]).includes(word) ? values[word as MessageWord] : all,
  );
}

// ---------- API shapes ----------

const name = (what: string, max = 100) =>
  z
    .string({ message: `Enter ${what}` })
    .trim()
    .min(1, `Enter ${what}`)
    .max(max);

export const schoolClassSchema = z.object({
  id: idSchema,
  schoolId: idSchema,
  name: z.string(),
  students: z.number(),
  agreedParents: z.number(),
});
export const schoolClassListSchema = z.object({ items: z.array(schoolClassSchema) });
export const classInputSchema = z.object({ schoolId: idSchema, name: name('a class name', 60) });
export const classUpdateSchema = z.object({ name: name('a class name', 60) });

export const contactRowSchema = z
  .object({
    id: z.string(),
    studentId: idSchema,
    guardianId: idSchema,
    schoolId: idSchema,
    classId: idSchema,
    className: z.string(),
    studentName: z.string().optional(),
    parentName: z.string().optional(),
    parentMobile: z.string().optional(),
    consent: z.enum(CONSENTS).optional(),
    consentChangedAt: z.string().nullable().optional(),
  })
  .catchall(z.unknown());
export type ContactRow = z.infer<typeof contactRowSchema>;

export const contactListQuerySchema = z.object({
  schoolId: idSchema,
  classId: idSchema.optional(),
  q: z.string().trim().max(100).optional(),
  consent: z.enum(CONSENTS).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const consentInputSchema = z.object({ consent: z.enum(CONSENTS) });

export const IMPORT_ACTIONS = ['new', 'update', 'unchanged', 'keeps_opt_out'] as const;
export const importPreviewSchema = z.object({
  problems: z.array(z.string()),
  rows: z.array(
    z.object({
      line: z.number(),
      className: z.string(),
      studentName: z.string(),
      parentName: z.string(),
      /** Only when the viewer may see parents' numbers. */
      parentMobile: z.string().nullable().optional(),
      agreed: z.boolean(),
      action: z.enum(IMPORT_ACTIONS).nullable(),
      errors: z.array(z.string()),
      notes: z.array(z.string()),
    }),
  ),
  summary: z.object({
    rows: z.number(),
    valid: z.number(),
    withErrors: z.number(),
    new: z.number(),
    updated: z.number(),
    unchanged: z.number(),
  }),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;
export const importResultSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  students: z.number(),
  parents: z.number(),
});

export const PARENT_MESSAGE_STATUSES = [
  'queued',
  'sending',
  'sent',
  'partly_sent',
  'failed',
  'skipped',
] as const;
export const PARENT_MESSAGE_STATUS_LABEL: Record<(typeof PARENT_MESSAGE_STATUSES)[number], string> =
  {
    queued: 'Waiting to send',
    sending: 'Sending',
    sent: 'Sent',
    partly_sent: 'Partly sent',
    failed: 'Failed',
    skipped: 'Not sent',
  };

export const parentMessageLogQuerySchema = z.object({
  schoolId: idSchema.optional(),
  status: z.enum(PARENT_MESSAGE_STATUSES).optional(),
  className: z.string().trim().max(60).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** One message to a class's parents: counts only, never numbers or children's names. */
export const parentMessageSummarySchema = z.object({
  id: idSchema,
  taskId: idSchema,
  taskTitle: z.string(),
  personName: z.string(),
  schoolName: z.string().nullable(),
  className: z.string(),
  templateName: z.string().nullable(),
  status: z.enum(PARENT_MESSAGE_STATUSES),
  skipReason: z.string().nullable(),
  recipientsCount: z.number(),
  sentCount: z.number(),
  failedCount: z.number(),
  skippedCount: z.number(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type ParentMessageSummary = z.infer<typeof parentMessageSummarySchema>;
export const parentMessageLogSchema = z.object({
  items: z.array(parentMessageSummarySchema),
  nextCursor: z.string().nullable(),
});

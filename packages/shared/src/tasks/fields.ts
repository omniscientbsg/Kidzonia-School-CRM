import type { FieldDef, Registry } from '../registry/index.js';

/**
 * Custom lists (brief 9.9) become fields of `tasks`, one per list, so they get
 * field permissions, show in the role editor and are whitelisted by
 * serialize() with no extra code. The field key doubles as the record prop
 * that carries the chosen value.
 */
export const LIST_FIELD_PREFIX = 'list_';

export function listFieldKey(listId: string): string {
  return `${LIST_FIELD_PREFIX}${listId.replaceAll('-', '')}`;
}

export function isListFieldKey(key: string): boolean {
  return key.startsWith(LIST_FIELD_PREFIX);
}

export interface CustomListRef {
  id: string;
  name: string;
}

export function listFields(lists: readonly CustomListRef[]): FieldDef[] {
  return lists.map((l) => ({ key: listFieldKey(l.id), label: l.name }));
}

/** The registry for one organisation: the shared one plus its custom lists. */
export function orgRegistry(base: Registry, lists: readonly CustomListRef[]): Registry {
  return lists.length === 0 ? base : base.withExtraFields('tasks', listFields(lists));
}

/** Words that fill themselves in when a parent message is sent (brief 9.12). */
export const MESSAGE_WORDS = [
  'student_name',
  'class_name',
  'event_name',
  'activity',
  'school_name',
] as const;

/** Splits a message into text and fill-in words, for previews. Unknown words stay text. */
export function messageParts(body: string): { text: string; word: boolean }[] {
  const out: { text: string; word: boolean }[] = [];
  let last = 0;
  for (const m of body.matchAll(/\{(\w+)\}/g)) {
    const word = (MESSAGE_WORDS as readonly string[]).includes(m[1] ?? '');
    if (!word) continue;
    if (m.index > last) out.push({ text: body.slice(last, m.index), word: false });
    out.push({ text: m[0], word: true });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last), word: false });
  return out;
}
